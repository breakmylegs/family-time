// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.38;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Test} from "forge-std/Test.sol";
import {FamilyLedger} from "../src/FamilyLedger.sol";

/// @dev Drives the ledger with random entries, and tries to break it the ways that matter: moving
/// tokens between children, using a reference twice, and undoing an entry twice. Keeps its own
/// count of what was minted and burned.
contract Handler is CommonBase, StdCheats, StdUtils {
    FamilyLedger public ledger;
    address public signer;
    bytes32 public constant HOUSE = keccak256("household");
    address[] public children;
    bytes32[] public refs;
    mapping(uint256 id => uint256) public minted;
    mapping(uint256 id => uint256) public burned;
    mapping(bytes32 ref => uint256) public timesReversed;
    uint256 public transfersThatWorked;
    uint256 public transfersRefusedOtherwise;
    uint256 public reusesThatWorked;
    uint256 public doubleReversals;
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

    function refund(uint256 seed, uint8 idSeed, uint32 amount, bool chosen) external {
        uint256 id = chosen ? (idSeed % 3) + 1 : 1;
        amount = uint32(bound(amount, 1, type(uint32).max));
        vm.prank(signer);
        ledger.refund(_ref(), _child(seed), id, amount, chosen, 1);
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
        uint256 allowed = (left / 30) * 10;
        if (allowed > 100) allowed = 100;
        bonus = uint32(bound(bonus, 0, allowed));
        vm.prank(signer);
        ledger.closeWeek(_ref(), HOUSE, child, left, bonus, 1);
        burned[1] += left;
        minted[2] += bonus;
    }

    function reverse(uint256 pick) external {
        if (refs.length == 0) return;
        bytes32 original = refs[pick % refs.length];
        FamilyLedger.Effect memory e = ledger.effectOf(original);
        bytes32 r = _ref();
        vm.prank(signer);
        try ledger.reverse(r, original, 1) {
            if (++timesReversed[original] > 1) doubleReversals++;
            _count(1, e.time);
            _count(2, e.money);
            _count(3, e.flex);
        } catch {
            // Not used after all: forget it, so the reuse check only tries real references.
            refs.pop();
        }
    }

    function _count(uint256 id, int256 amount) private {
        if (amount > 0) burned[id] += uint256(amount);
        else if (amount < 0) minted[id] += uint256(-amount);
    }

    /// Tries a transfer the child could afford, so only the soulbound rule can refuse it.
    function tryTransfer(uint256 from, uint8 idSeed, uint256 amount, bool batch) external {
        address a = _child(from);
        address b = _child(from + 1);
        uint256 id = (idSeed % 3) + 1;
        amount = bound(amount, 0, ledger.balanceOf(a, id));
        vm.startPrank(a);
        if (batch) {
            uint256[] memory ids = new uint256[](1);
            uint256[] memory values = new uint256[](1);
            ids[0] = id;
            values[0] = amount;
            try ledger.safeBatchTransferFrom(a, b, ids, values, "") {
                transfersThatWorked++;
            } catch (bytes memory err) {
                if (bytes4(err) != FamilyLedger.Soulbound.selector) transfersRefusedOtherwise++;
            }
        } else {
            try ledger.safeTransferFrom(a, b, id, amount, "") {
                transfersThatWorked++;
            } catch (bytes memory err) {
                if (bytes4(err) != FamilyLedger.Soulbound.selector) transfersRefusedOtherwise++;
            }
        }
        vm.stopPrank();
    }

    /// Tries a used reference on every kind of entry.
    function tryReuse(uint256 pick, uint256 seed, uint8 kind) external {
        if (refs.length == 0) return;
        bytes32 r = refs[pick % refs.length];
        address child = _child(seed);
        vm.startPrank(signer);
        kind = kind % 4;
        bool worked;
        if (kind == 0) {
            try ledger.award(r, child, 2, 1, 1) {
                worked = true;
            } catch {}
        } else if (kind == 1) {
            try ledger.allocateAllowance(r, child, 1, 1) {
                worked = true;
            } catch {}
        } else if (kind == 2) {
            try ledger.refund(r, child, 1, 1, false, 1) {
                worked = true;
            } catch {}
        } else {
            try ledger.closeWeek(r, HOUSE, child, 0, 0, 1) {
                worked = true;
            } catch {}
        }
        vm.stopPrank();
        if (worked) reusesThatWorked++;
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
        ledger.setBonusRule(house, 10, 100);
        vm.stopPrank();
        targetContract(address(handler));
        // Only the actions, not the handler's getters.
        bytes4[] memory actions = new bytes4[](11);
        actions[0] = Handler.allocate.selector;
        actions[1] = Handler.award.selector;
        actions[2] = Handler.refund.selector;
        actions[3] = Handler.spend.selector;
        actions[4] = Handler.convert.selector;
        actions[5] = Handler.payout.selector;
        actions[6] = Handler.closeWeek.selector;
        actions[7] = Handler.reverse.selector;
        actions[8] = Handler.tryTransfer.selector;
        actions[9] = Handler.tryReuse.selector;
        actions[10] = Handler.reverse.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: actions}));
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

    /// No transfer ever succeeds, and the soulbound rule is what refuses it.
    function invariant_noTransfer() public view {
        assertEq(handler.transfersThatWorked(), 0);
        assertEq(handler.transfersRefusedOtherwise(), 0);
    }

    /// A reference is never used twice.
    function invariant_noReuse() public view {
        assertEq(handler.reusesThatWorked(), 0);
    }

    /// No entry is undone twice.
    function invariant_undoneAtMostOnce() public view {
        assertEq(handler.doubleReversals(), 0);
    }
}
