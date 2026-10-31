// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {FamilyLedger} from "../src/FamilyLedger.sol";

/// @dev Drives the ledger with random entries, and tries to break it the ways that matter: moving
/// tokens between children, and using a reference twice. Keeps its own count of what was minted
/// and burned.
contract Handler is Test {
    FamilyLedger public ledger;
    address public signer;
    bytes32 public constant HOUSE = keccak256("household");
    address[] public children;
    bytes32[] public refs;
    mapping(uint256 id => uint256) public minted;
    mapping(uint256 id => uint256) public burned;
    uint256 public transfersThatWorked;
    uint256 public reusesThatWorked;
    uint256 n;

    constructor(FamilyLedger ledger_, address signer_) {
        ledger = ledger_;
        signer = signer_;
        children.push(makeAddr("ollie"));
        children.push(makeAddr("jamie"));
    }

    function childCount() external view returns (uint256) {
        return children.length;
    }

    function _child(uint256 seed) private view returns (address) {
        return children[seed % children.length];
    }

    function _ref() private returns (bytes32 r) {
        r = keccak256(abi.encode("invariant", ++n));
        refs.push(r);
    }

    function allocate(uint256 seed, uint32 mins) external {
        vm.prank(signer);
        ledger.allocateAllowance(_ref(), _child(seed), mins, 1);
        minted[1] += mins;
    }

    function award(uint256 seed, uint8 idSeed, uint32 amount) external {
        uint256 id = (idSeed % 3) + 1;
        amount = uint32(bound(amount, 1, type(uint32).max));
        vm.prank(signer);
        ledger.award(_ref(), _child(seed), id, amount, 1);
        minted[id] += amount;
    }

    function spend(uint256 seed, uint32 mins) external {
        address child = _child(seed);
        uint256 have = ledger.balanceOf(child, 1);
        if (have == 0) return;
        mins = uint32(bound(mins, 1, have));
        vm.prank(signer);
        ledger.spendTime(_ref(), child, mins, 1);
        burned[1] += mins;
    }

    function convert(uint256 seed, uint32 points, bool toMoney) external {
        address child = _child(seed);
        uint256 have = ledger.balanceOf(child, 3);
        if (have == 0) return;
        points = uint32(bound(points, 1, have));
        uint256 toId = toMoney ? 2 : 1;
        vm.prank(signer);
        ledger.convert(_ref(), HOUSE, child, points, toId, points, 1);
        burned[3] += points;
        minted[toId] += points;
    }

    function payout(uint256 seed, uint32 pence) external {
        address child = _child(seed);
        uint256 have = ledger.balanceOf(child, 2);
        if (have == 0) return;
        pence = uint32(bound(pence, 1, have));
        vm.prank(signer);
        ledger.recordPayout(_ref(), child, pence, 1);
        burned[2] += pence;
    }

    function closeWeek(uint256 seed, uint32 bonus) external {
        address child = _child(seed);
        uint256 left = ledger.balanceOf(child, 1);
        bonus = uint32(bound(bonus, 0, 100));
        vm.prank(signer);
        ledger.closeWeek(_ref(), child, left, bonus, 1);
        burned[1] += left;
        minted[2] += bonus;
    }

    function reverse(uint256 pick) external {
        if (refs.length == 0) return;
        bytes32 original = refs[pick % refs.length];
        FamilyLedger.Effect memory e = ledger.effectOf(original);
        vm.prank(signer);
        try ledger.reverse(keccak256(abi.encode("reversal", ++n)), original, 1) {
            _count(1, e.time);
            _count(2, e.money);
            _count(3, e.flex);
        } catch {}
    }

    function _count(uint256 id, int256 amount) private {
        if (amount > 0) burned[id] += uint256(amount);
        else if (amount < 0) minted[id] += uint256(-amount);
    }

    function tryTransfer(uint256 from, uint256 to, uint8 idSeed, uint32 amount) external {
        address a = _child(from);
        address b = _child(to + 1);
        vm.prank(a);
        try ledger.safeTransferFrom(a, b, (idSeed % 3) + 1, amount, "") {
            transfersThatWorked++;
        } catch {}
    }

    function tryReuse(uint256 pick, uint256 seed) external {
        if (refs.length == 0) return;
        vm.prank(signer);
        try ledger.award(refs[pick % refs.length], _child(seed), 2, 1, 1) {
            reusesThatWorked++;
        } catch {}
    }
}

contract FamilyLedgerInvariantTest is Test {
    FamilyLedger ledger;
    Handler handler;

    function setUp() public {
        address signer = makeAddr("signer");
        ledger = new FamilyLedger(makeAddr("admin"), signer);
        handler = new Handler(ledger, signer);
        bytes32 house = handler.HOUSE();
        vm.startPrank(signer);
        ledger.setRate(house, 1, 1);
        ledger.setRate(house, 2, 1);
        vm.stopPrank();
        targetContract(address(handler));
    }

    /// Supply equals minted minus burned, for every token.
    function invariant_supplyIsMintedLessBurned() public view {
        for (uint256 id = 1; id <= 3; id++) {
            assertEq(ledger.totalSupply(id), handler.minted(id) - handler.burned(id));
        }
    }

    /// Every token is in a child's account: the children's balances add up to the supply.
    function invariant_balancesAddUp() public view {
        for (uint256 id = 1; id <= 3; id++) {
            uint256 sum;
            for (uint256 i = 0; i < handler.childCount(); i++) sum += ledger.balanceOf(handler.children(i), id);
            assertEq(sum, ledger.totalSupply(id));
        }
    }

    /// No transfer ever succeeds.
    function invariant_noTransfer() public view {
        assertEq(handler.transfersThatWorked(), 0);
    }

    /// A reference is never used twice.
    function invariant_noReuse() public view {
        assertEq(handler.reusesThatWorked(), 0);
    }
}
