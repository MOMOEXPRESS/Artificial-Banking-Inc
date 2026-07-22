// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AbincToken} from "../src/AbincToken.sol";

contract AbincTokenTest is Test {
    AbincToken internal token;
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");

    function setUp() public {
        token = new AbincToken(treasury);
    }

    function test_metadata() public view {
        assertEq(token.name(), "Artificial Banking");
        assertEq(token.symbol(), "ABINC");
        assertEq(token.decimals(), 18);
        assertEq(token.MAX_SUPPLY(), 1_000_000_000 ether);
    }

    function test_mintsFullSupplyToTreasury() public view {
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(treasury), 1_000_000_000 ether);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_revertZeroTreasury() public {
        vm.expectRevert(AbincToken.ZeroTreasury.selector);
        new AbincToken(address(0));
    }

    function test_transfer() public {
        vm.prank(treasury);
        token.transfer(alice, 100 ether);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.balanceOf(treasury), 1_000_000_000 ether - 100 ether);
    }

    function test_burn() public {
        vm.prank(treasury);
        token.burn(1_000 ether);
        assertEq(token.totalSupply(), 1_000_000_000 ether - 1_000 ether);
        assertEq(token.balanceOf(treasury), 1_000_000_000 ether - 1_000 ether);
    }

    function test_noFurtherMint() public view {
        // Fixed supply: there is no public mint. Only constructor minted.
        assertEq(token.totalSupply(), token.MAX_SUPPLY());
    }
}
