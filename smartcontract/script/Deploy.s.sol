// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PriceBetGame} from "../src/PriceBetGame.sol";

/// @notice Deploys PriceBetGame to Monad and optionally seeds the house bankroll.
/// @dev Env vars (all optional):
///        OPERATOR_ADDRESS  - operator that runs rounds (defaults to deployer)
///        INITIAL_BANKROLL  - wei of MON to fund the house with on deploy (default 0)
///      Run with: forge script script/Deploy.s.sol --rpc-url https://rpc.monad.xyz \
///                  --account monad-deployer --broadcast
contract Deploy is Script {
    function run() external returns (PriceBetGame game) {
        address operator = vm.envOr("OPERATOR_ADDRESS", address(0));
        uint256 bankroll = vm.envOr("INITIAL_BANKROLL", uint256(0));

        vm.startBroadcast();

        game = new PriceBetGame(operator);
        if (bankroll > 0) {
            game.fundHouse{value: bankroll}();
        }

        vm.stopBroadcast();

        console.log("PriceBetGame deployed at:", address(game));
        console.log("owner:", game.owner());
        console.log("operator:", game.operator());
        console.log("betAmount (wei):", game.betAmount());
        console.log("bankroll funded (wei):", bankroll);
    }
}
