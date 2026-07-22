// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title ABINC
 * @notice Community / build token for Artificial Banking Incorporated.
 *
 * IMPORTANT — what this is NOT:
 * - Not wired into the guardian console, agent wallets, or USDC vaults
 * - Not a deposit claim, stablecoin, bank liability, or FDIC-related instrument
 * - Not required to use the product
 *
 * Product settlement remains USDC on Base. This token is optional community /
 * fundraising float with a fixed supply minted once to a treasury address.
 */
contract AbincToken is ERC20, ERC20Burnable, ERC20Permit {
    /// @dev 1,000,000,000 ABINC (18 decimals)
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    error ZeroTreasury();

    /**
     * @param treasury Address that receives the entire fixed supply at deploy.
     *                 Use a multisig / Safe in production.
     */
    constructor(address treasury) ERC20("Artificial Banking", "ABINC") ERC20Permit("Artificial Banking") {
        if (treasury == address(0)) revert ZeroTreasury();
        _mint(treasury, MAX_SUPPLY);
    }
}
