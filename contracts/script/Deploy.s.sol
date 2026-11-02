// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ConcordLedger} from "../src/ConcordLedger.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        ConcordLedger ledger = new ConcordLedger();
        vm.stopBroadcast();
        console.log("ConcordLedger:", address(ledger));
    }
}
