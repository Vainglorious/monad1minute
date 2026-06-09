// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PriceBetGame} from "../src/PriceBetGame.sol";

contract PriceBetGameTest is Test {
    PriceBetGame game;

    address owner = address(this); // the test contract deploys, so it is owner+operator
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 constant BET = 10 ether;
    uint256 constant HOUSE = 2000 ether; // generous bankroll (worst-case reservation is 20x/bet)

    // default multipliers (scaled by 100): A:20x B:10x C:2.8x D:2.8x E:10x F:20x
    uint256 constant PAY_EXTREME = 200 ether; // 10 * 20
    uint256 constant PAY_MID = 100 ether; // 10 * 10  (B, E)
    uint256 constant PAY_NEAR = 28 ether; // 10 * 2.8 (C, D)

    function setUp() public {
        game = new PriceBetGame(address(0)); // operator defaults to deployer (this contract)
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.deal(carol, 1000 ether);
    }

    receive() external payable {} // accept house withdrawals

    function _bet(address who, PriceBetGame.Bucket bucket) internal {
        vm.prank(who);
        game.placeBet{value: BET}(bucket);
    }

    // ----------------------------------------------------------------------------------
    // Classification (unchanged)
    // ----------------------------------------------------------------------------------

    function test_Classify_Boundaries() public view {
        assertEq(uint8(game.classify(11)), uint8(PriceBetGame.Bucket.A));
        assertEq(uint8(game.classify(10)), uint8(PriceBetGame.Bucket.B));
        assertEq(uint8(game.classify(6)), uint8(PriceBetGame.Bucket.B));
        assertEq(uint8(game.classify(5)), uint8(PriceBetGame.Bucket.C));
        assertEq(uint8(game.classify(0)), uint8(PriceBetGame.Bucket.C));
        assertEq(uint8(game.classify(-1)), uint8(PriceBetGame.Bucket.D));
        assertEq(uint8(game.classify(-5)), uint8(PriceBetGame.Bucket.D));
        assertEq(uint8(game.classify(-6)), uint8(PriceBetGame.Bucket.E));
        assertEq(uint8(game.classify(-10)), uint8(PriceBetGame.Bucket.E));
        assertEq(uint8(game.classify(-11)), uint8(PriceBetGame.Bucket.F));
    }

    function testFuzz_ClassifyNeverReverts(int256 bps) public view {
        assertLe(uint8(game.classify(bps)), uint8(PriceBetGame.Bucket.F));
    }

    // ----------------------------------------------------------------------------------
    // Per-bucket payouts
    // ----------------------------------------------------------------------------------

    function test_DefaultMultipliers() public view {
        assertEq(game.bucketMultiplier(0), 2000); // A
        assertEq(game.bucketMultiplier(1), 1000); // B
        assertEq(game.bucketMultiplier(2), 280); // C
        assertEq(game.bucketMultiplier(3), 280); // D
        assertEq(game.bucketMultiplier(4), 1000); // E
        assertEq(game.bucketMultiplier(5), 2000); // F
        assertEq(game.maxMultiplier(), 2000);
    }

    function test_Payout_Extreme() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A);
        vm.warp(block.timestamp + 61);
        game.resolveRound(15); // +0.15% -> A (20x)
        uint256 before = alice.balance;
        vm.prank(alice);
        game.claim(1);
        assertEq(alice.balance - before, PAY_EXTREME); // 200
    }

    function test_Payout_MidTier_BandE() public {
        // B (10x)
        game.fundHouse{value: HOUSE}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.B);
        vm.warp(block.timestamp + 61);
        game.resolveRound(8); // +0.08% -> B
        uint256 before = alice.balance;
        vm.prank(alice);
        game.claim(1);
        assertEq(alice.balance - before, PAY_MID); // 100
    }

    function test_Payout_NearZero_CandD() public {
        // C (2.8x) — verifies fractional multiplier via /100 scaling
        game.fundHouse{value: HOUSE}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.C);
        vm.warp(block.timestamp + 61);
        game.resolveRound(3); // +0.03% -> C
        uint256 before = alice.balance;
        vm.prank(alice);
        game.claim(1);
        assertEq(alice.balance - before, PAY_NEAR); // 28
    }

    function test_LoserCannotClaim() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A);
        _bet(bob, PriceBetGame.Bucket.C);
        vm.warp(block.timestamp + 61);
        game.resolveRound(15); // A wins
        vm.prank(bob);
        vm.expectRevert(bytes("not a winner"));
        game.claim(1);
    }

    function test_MultipleWinnersSameBucket() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.F);
        _bet(bob, PriceBetGame.Bucket.F);
        _bet(carol, PriceBetGame.Bucket.A);
        vm.warp(block.timestamp + 61);
        game.resolveRound(-20); // F (20x)
        uint256 a0 = alice.balance;
        uint256 b0 = bob.balance;
        vm.prank(alice);
        game.claim(1);
        vm.prank(bob);
        game.claim(1);
        assertEq(alice.balance - a0, PAY_EXTREME);
        assertEq(bob.balance - b0, PAY_EXTREME);
    }

    // ----------------------------------------------------------------------------------
    // Guards
    // ----------------------------------------------------------------------------------

    function test_RevertWhen_WrongStake() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        vm.prank(alice);
        vm.expectRevert(bytes("wrong stake"));
        game.placeBet{value: 9 ether}(PriceBetGame.Bucket.A);
    }

    function test_RevertWhen_BetAfterLock() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        vm.warp(block.timestamp + 61);
        vm.prank(alice);
        vm.expectRevert(bytes("betting closed"));
        game.placeBet{value: BET}(PriceBetGame.Bucket.A);
    }

    function test_RevertWhen_DoubleBet() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A);
        vm.prank(alice);
        vm.expectRevert(bytes("already bet"));
        game.placeBet{value: BET}(PriceBetGame.Bucket.B);
    }

    function test_RevertWhen_NoActiveRound() public {
        game.fundHouse{value: HOUSE}();
        vm.prank(alice);
        vm.expectRevert(bytes("no active round"));
        game.placeBet{value: BET}(PriceBetGame.Bucket.A);
    }

    function test_RevertWhen_ResolveBeforeLock() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A);
        vm.expectRevert(bytes("betting open"));
        game.resolveRound(15);
    }

    function test_RevertWhen_NonOperatorResolves() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        vm.warp(block.timestamp + 61);
        vm.prank(alice);
        vm.expectRevert(bytes("not operator"));
        game.resolveRound(15);
    }

    function test_RevertWhen_StartWhileActive() public {
        game.startRound();
        vm.expectRevert(bytes("round active"));
        game.startRound();
    }

    function test_RevertWhen_DoubleClaim() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A);
        vm.warp(block.timestamp + 61);
        game.resolveRound(15);
        vm.prank(alice);
        game.claim(1);
        vm.prank(alice);
        vm.expectRevert(bytes("already claimed"));
        game.claim(1);
    }

    // ----------------------------------------------------------------------------------
    // Solvency (worst-case reservation now uses maxMultiplier = 20x)
    // ----------------------------------------------------------------------------------

    function test_RevertWhen_HouseUnderfunded() public {
        // No bankroll: first bet adds 10 but worst case reserves 10*20 = 200 -> revert.
        game.startRound();
        vm.prank(alice);
        vm.expectRevert(bytes("house underfunded"));
        game.placeBet{value: BET}(PriceBetGame.Bucket.A);
    }

    function test_ReservedReleasedForNearZeroOutcome() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.C);
        assertEq(game.reserved(), 200 ether); // worst case: 1 * 10 * 20x

        vm.warp(block.timestamp + 61);
        game.resolveRound(3); // C wins (2.8x) -> payout 28, 1 winner
        assertEq(game.reserved(), PAY_NEAR); // 28

        vm.prank(alice);
        game.claim(1);
        assertEq(game.reserved(), 0);
    }

    function test_ReservedZeroWhenNoWinners() public {
        game.fundHouse{value: HOUSE}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A);
        vm.warp(block.timestamp + 61);
        game.resolveRound(-20); // F wins, alice (A) loses, no winners
        assertEq(game.reserved(), 0);
    }

    function test_OwnerCannotWithdrawReserved() public {
        game.fundHouse{value: 1000 ether}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A); // reserves 200; balance 1010, free 810
        assertEq(game.freeBalance(), 810 ether);
        vm.expectRevert(bytes("exceeds free balance"));
        game.withdraw(811 ether);
        game.withdraw(810 ether);
        assertEq(game.freeBalance(), 0);
    }

    function test_OwnerWithdrawFreeBankroll() public {
        game.fundHouse{value: 100 ether}();
        uint256 before = owner.balance;
        game.withdraw(40 ether);
        assertEq(owner.balance - before, 40 ether);
    }

    // ----------------------------------------------------------------------------------
    // Config
    // ----------------------------------------------------------------------------------

    function test_SetBucketMultipliers() public {
        uint256[6] memory m = [uint256(1500), 800, 250, 250, 800, 1500];
        game.setBucketMultipliers(m);
        assertEq(game.bucketMultiplier(0), 1500);
        assertEq(game.bucketMultiplier(2), 250);
        assertEq(game.maxMultiplier(), 1500);
        uint256[6] memory got = game.getBucketMultipliers();
        assertEq(got[5], 1500);
    }

    function test_RevertWhen_MultiplierBelowOne() public {
        uint256[6] memory m = [uint256(2000), 1000, 99, 280, 1000, 2000]; // 99 < 100 (1x)
        vm.expectRevert(bytes("multiplier < 1x"));
        game.setBucketMultipliers(m);
    }

    function test_RevertWhen_SetMultipliersDuringActiveRound() public {
        game.startRound();
        uint256[6] memory m = [uint256(2000), 1000, 280, 280, 1000, 2000];
        vm.expectRevert(bytes("round active"));
        game.setBucketMultipliers(m);
    }

    function test_RevertWhen_NonOwnerConfig() public {
        vm.prank(alice);
        vm.expectRevert(bytes("not owner"));
        game.setBetAmount(1 ether);
    }

    function test_ConfigSetters() public {
        game.setBetAmount(1 ether);
        game.setBettingDuration(10);
        assertEq(game.betAmount(), 1 ether);
        assertEq(game.bettingDuration(), 10);
    }

    function test_SmallBetAmount_LiveSmokeShape() public {
        // mirrors a cheap live smoke test: tiny stake, full round end-to-end
        game.setBetAmount(0.1 ether);
        game.fundHouse{value: 10 ether}();
        game.startRound();
        vm.prank(alice);
        game.placeBet{value: 0.1 ether}(PriceBetGame.Bucket.A);
        vm.warp(block.timestamp + 61);
        game.resolveRound(50);
        uint256 before = alice.balance;
        vm.prank(alice);
        game.claim(1);
        assertEq(alice.balance - before, 2 ether); // 0.1 * 20x
    }
}
