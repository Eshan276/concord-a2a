// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConcordLedger} from "../src/ConcordLedger.sol";

contract ConcordLedgerTest is Test {
    ConcordLedger ledger;
    bytes32 constant CAFE = keccak256("monsoon-cafe");
    bytes32 constant ROASTER = keccak256("bluepeak-roasters");
    bytes32 constant SKU = keccak256("roasted-coffee");

    function setUp() public {
        ledger = new ConcordLedger();
        ledger.registerCompany(CAFE, "Monsoon Cafe", address(0xCAFE), 1);
        ledger.registerCompany(ROASTER, "Bluepeak Roasters", address(0xBEEF), 2);
    }

    function test_registryPayee() public view {
        assertEq(ledger.payeeOf(ROASTER), address(0xBEEF));
        assertEq(ledger.companyCount(), 2);
    }

    function test_recordSettlement() public {
        ledger.recordSettlement(keccak256("rfq-1"), CAFE, ROASTER, SKU, 60, 14_500_000, 14_500_000, bytes32(uint256(1)), "PR-rfq-1", "");
        assertEq(ledger.settlementCount(), 1);
        assertEq(ledger.refPriceMicros(SKU), 14_500_000);
        (,,,, uint64 trades,, uint128 vol,) = ledger.companies(ROASTER);
        assertEq(trades, 1);
        assertEq(vol, 60 * 14_500_000);
    }

    function test_settlementIdempotent() public {
        ledger.recordSettlement(keccak256("rfq-1"), CAFE, ROASTER, SKU, 1, 1, 1, bytes32(0), "PR", "");
        vm.expectRevert(abi.encodeWithSelector(ConcordLedger.AlreadySettled.selector, keccak256("rfq-1")));
        ledger.recordSettlement(keccak256("rfq-1"), CAFE, ROASTER, SKU, 1, 1, 1, bytes32(0), "PR", "");
    }

    function test_violationsLowerReputation() public {
        ledger.recordSettlement(keccak256("rfq-1"), CAFE, ROASTER, SKU, 1, 1, 1, bytes32(0), "PR", "");
        ledger.reportViolation(ROASTER, keccak256("rfq-2"), "NO_DISTRESS_SURGE");
        assertEq(ledger.reputationBps(ROASTER), 5_000);
    }

    function test_onlyOperatorWrites() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(ConcordLedger.NotOperator.selector);
        ledger.reportViolation(ROASTER, bytes32(0), "X");
    }

    function test_unknownCompanyRejected() public {
        vm.expectRevert(abi.encodeWithSelector(ConcordLedger.UnknownCompany.selector, keccak256("ghost")));
        ledger.reportViolation(keccak256("ghost"), bytes32(0), "X");
    }
}
