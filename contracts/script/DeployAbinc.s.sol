// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AbincToken} from "../src/AbincToken.sol";

/**
 * Deploy ABINC to Base Sepolia or Base mainnet.
 *
 * Required env:
 *   PRIVATE_KEY   — deployer key (hex, with or without 0x)
 *   TREASURY      — receives full supply (prefer a Safe / multisig)
 *
 * Example (Base Sepolia):
 *   forge script script/DeployAbinc.s.sol:DeployAbinc \
 *     --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
 */
contract DeployAbinc is Script {
    function run() external returns (AbincToken token) {
        address treasury = vm.envAddress("TREASURY");
        uint256 pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);
        token = new AbincToken(treasury);
        vm.stopBroadcast();

        console2.log("ABINC deployed at", address(token));
        console2.log("treasury", treasury);
        console2.log("totalSupply", token.totalSupply());
        console2.log("name", token.name());
        console2.log("symbol", token.symbol());
    }
}
