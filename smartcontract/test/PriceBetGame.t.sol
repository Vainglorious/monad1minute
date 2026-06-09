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

    function setUp() public {
        game = new PriceBetGame(address(0)); // operator defaults to deployer (this contract)
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.deal(carol, 1000 ether);
    }

    // test contract must accept the house withdrawal transfer
    receive() external payable {}

    // ----------------------------------------------------------------------------------
    // Classification
    // ----------------------------------------------------------------------------------

    function test_Classify_Boundaries() public view {
        assertEq(uint8(game.classify(11)), uint8(PriceBetGame.Bucket.A));
        assertEq(uint8(game.classify(10)), uint8(PriceBetGame.Bucket.B));
        assertEq(uint8(game.classify(6)), uint8(PriceBetGame.Bucket.B));
        assertEq(uint8(game.classify(5)), uint8(PriceBetGame.Bucket.C));
        assertEq(uint8(game.classify(1)), uint8(PriceBetGame.Bucket.C));
        assertEq(uint8(game.classify(0)), uint8(PriceBetGame.Bucket.C));
        assertEq(uint8(game.classify(-1)), uint8(PriceBetGame.Bucket.D));
        assertEq(uint8(game.classify(-5)), uint8(PriceBetGame.Bucket.D));
        assertEq(uint8(game.classify(-6)), uint8(PriceBetGame.Bucket.E));
        assertEq(uint8(game.classify(-10)), uint8(PriceBetGame.Bucket.E));
        assertEq(uint8(game.classify(-11)), uint8(PriceBetGame.Bucket.F));
    }

    function test_IsExtreme() public view {
        assertTrue(game.isExtreme(PriceBetGame.Bucket.A));
        assertTrue(game.isExtreme(PriceBetGame.Bucket.F));
        assertFalse(game.isExtreme(PriceBetGame.Bucket.B));
        assertFalse(game.isExtreme(PriceBetGame.Bucket.C));
        assertFalse(game.isExtreme(PriceBetGame.Bucket.D));
        assertFalse(game.isExtreme(PriceBetGame.Bucket.E));
    }

    function testFuzz_ClassifyNeverReverts(int256 bps) public view {
        PriceBetGame.Bucket b = game.classify(bps);
        assertLe(uint8(b), uint8(PriceBetGame.Bucket.F));
    }

    // ----------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------

    function _bet(address who, PriceBetGame.Bucket bucket) internal {
        vm.prank(who);
        game.placeBet{value: BET}(bucket);
    }

    // ----------------------------------------------------------------------------------
    // Happy path + payout tiers
    // ----------------------------------------------------------------------------------

    function test_HappyPath_ExtremeWinner() public {
        game.fundHouse{value: 500 ether}();
        game.startRound();

        _bet(alice, PriceBetGame.Bucket.A); // extreme - will win
        _bet(bob, PriceBetGame.Bucket.C); // middle - will lose

        vm.warp(block.timestamp + 61);
        game.resolveRound(15); // +0.15% -> bucket A

        uint256 before = alice.balance;
        vm.prank(alice);
        game.claim(1);
        assertEq(alice.balance - before, 50 ether); // 10 * 5x extreme

        // loser cannot claim
        vm.prank(bob);
        vm.expectRevert(bytes("not a winner"));
        game.claim(1);
    }

    function test_HappyPath_MiddleWinner() public {
        game.fundHouse{value: 500 ether}();
        game.startRound();

        _bet(alice, PriceBetGame.Bucket.C); // middle - will win
        _bet(bob, PriceBetGame.Bucket.A); // extreme - will lose

        vm.warp(block.timestamp + 61);
        game.resolveRound(3); // +0.03% -> bucket C

        uint256 before = alice.balance;
        vm.prank(alice);
        game.claim(1);
        assertEq(alice.balance - before, 20 ether); // 10 * 2x middle
    }

    function test_MultipleWinnersSameBucket() public {
        game.fundHouse{value: 500 ether}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.F);
        _bet(bob, PriceBetGame.Bucket.F);
        _bet(carol, PriceBetGame.Bucket.A);

        vm.warp(block.timestamp + 61);
        game.resolveRound(-20); // bucket F, extreme

        uint256 a0 = alice.balance;
        uint256 b0 = bob.balance;
        vm.prank(alice);
        game.claim(1);
        vm.prank(bob);
        game.claim(1);
        assertEq(alice.balance - a0, 50 ether);
        assertEq(bob.balance - b0, 50 ether);
    }

    // ----------------------------------------------------------------------------------
    // Guards
    // ----------------------------------------------------------------------------------

    function test_RevertWhen_WrongStake() public {
        game.fundHouse{value: 500 ether}();
        game.startRound();
        vm.prank(alice);
        vm.expectRevert(bytes("wrong stake"));
        game.placeBet{value: 9 ether}(PriceBetGame.Bucket.A);
    }

    function test_RevertWhen_BetAfterLock() public {
        game.fundHouse{value: 500 ether}();
        game.startRound();
        vm.warp(block.timestamp + 61);
        vm.prank(alice);
        vm.expectRevert(bytes("betting closed"));
        game.placeBet{value: BET}(PriceBetGame.Bucket.A);
    }

    function test_RevertWhen_DoubleBet() public {
        game.fundHouse{value: 500 ether}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A);
        vm.prank(alice);
        vm.expectRevert(bytes("already bet"));
        game.placeBet{value: BET}(PriceBetGame.Bucket.B);
    }

    function test_RevertWhen_NoActiveRound() public {
        game.fundHouse{value: 500 ether}();
        vm.prank(alice);
        vm.expectRevert(bytes("no active round"));
        game.placeBet{value: BET}(PriceBetGame.Bucket.A);
    }

    function test_RevertWhen_ResolveBeforeLock() public {
        game.fundHouse{value: 500 ether}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A);
        vm.expectRevert(bytes("betting open"));
        game.resolveRound(15);
    }

    function test_RevertWhen_NonOperatorResolves() public {
        game.fundHouse{value: 500 ether}();
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
        game.fundHouse{value: 500 ether}();
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
    // Solvency / bankroll
    // ----------------------------------------------------------------------------------

    function test_RevertWhen_HouseUnderfunded() public {
        // No bankroll: first bet adds 10 MON but worst case reserves 50 -> revert.
        game.startRound();
        vm.prank(alice);
        vm.expectRevert(bytes("house underfunded"));
        game.placeBet{value: BET}(PriceBetGame.Bucket.A);
    }

    function test_ReservedReleasedForMiddleOutcome() public {
        game.fundHouse{value: 500 ether}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.C);
        // worst case reserved while live: 1 * 10 * 5 = 50
        assertEq(game.reserved(), 50 ether);

        vm.warp(block.timestamp + 61);
        game.resolveRound(3); // middle winner -> payout 20 each, 1 winner
        assertEq(game.reserved(), 20 ether);

        vm.prank(alice);
        game.claim(1);
        assertEq(game.reserved(), 0);
    }

    function test_ReservedZeroWhenNoWinners() public {
        game.fundHouse{value: 500 ether}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A); // bets extreme up
        vm.warp(block.timestamp + 61);
        game.resolveRound(-20); // outcome F: alice loses, no winners
        assertEq(game.reserved(), 0);
    }

    function test_OwnerCannotWithdrawReserved() public {
        game.fundHouse{value: 100 ether}();
        game.startRound();
        _bet(alice, PriceBetGame.Bucket.A); // reserves 50; balance = 110, free = 60
        assertEq(game.freeBalance(), 60 ether);
        vm.expectRevert(bytes("exceeds free balance"));
        game.withdraw(61 ether);
        // withdrawing exactly free balance works
        game.withdraw(60 ether);
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

    function test_ConfigSetters() public {
        game.setBetAmount(1 ether);
        game.setMultipliers(8, 3);
        game.setBettingDuration(10);
        assertEq(game.betAmount(), 1 ether);
        assertEq(game.extremeMultiplier(), 8);
        assertEq(game.middleMultiplier(), 3);
        assertEq(game.bettingDuration(), 10);
    }

    function test_RevertWhen_ConfigDuringActiveRound() public {
        game.startRound();
        vm.expectRevert(bytes("round active"));
        game.setBetAmount(1 ether);
    }

    function test_RevertWhen_NonOwnerConfig() public {
        vm.prank(alice);
        vm.expectRevert(bytes("not owner"));
        game.setBetAmount(1 ether);
    }

    function test_SmallBetAmount_LiveSmokeShape() public {
        // mirrors the cheap live smoke test: tiny stake, full round end-to-end
        game.setBetAmount(0.1 ether);
        game.fundHouse{value: 1 ether}();
        game.startRound();
        vm.prank(alice);
        game.placeBet{value: 0.1 ether}(PriceBetGame.Bucket.A);
        vm.warp(block.timestamp + 61);
        game.resolveRound(50);
        uint256 before = alice.balance;
        vm.prank(alice);
        game.claim(1);
        assertEq(alice.balance - before, 0.5 ether); // 0.1 * 5x
    }
}
