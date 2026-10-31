// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.38;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {FamilyLedger} from "../src/FamilyLedger.sol";

contract FamilyLedgerTest is Test {
    FamilyLedger ledger;
    address admin = makeAddr("admin");
    address signer = makeAddr("signer");
    address ollie = makeAddr("ollie");
    address jamie = makeAddr("jamie");
    bytes32 constant HOUSE = keccak256("household");
    uint256 constant TIME = 1;
    uint256 constant MONEY = 2;
    uint256 constant FLEX = 3;
    uint256 n;

    function setUp() public {
        ledger = new FamilyLedger(admin, signer);
        vm.startPrank(signer);
        ledger.setRate(HOUSE, MONEY, 1);
        ledger.setRate(HOUSE, TIME, 1);
        vm.stopPrank();
    }

    function ref() internal returns (bytes32) {
        return keccak256(abi.encode("ref", ++n));
    }

    function test_allowanceSpendAndClose() public {
        vm.startPrank(signer);
        ledger.allocateAllowance(ref(), ollie, 420, 1);
        ledger.spendTime(ref(), ollie, 30, 2);
        assertEq(ledger.balanceOf(ollie, TIME), 390);
        ledger.closeWeek(ref(), ollie, 390, 100, 3);
        assertEq(ledger.balanceOf(ollie, TIME), 0);
        assertEq(ledger.balanceOf(ollie, MONEY), 100);
        assertEq(ledger.balanceOf(jamie, TIME), 0);
        vm.stopPrank();
    }

    function test_cannotSpendMoreThanIsLeft() public {
        vm.startPrank(signer);
        ledger.allocateAllowance(ref(), ollie, 30, 1);
        vm.expectRevert();
        ledger.spendTime(ref(), ollie, 60, 2);
        vm.stopPrank();
    }

    function test_aReferenceIsUsedOnce() public {
        bytes32 r = ref();
        vm.startPrank(signer);
        ledger.award(r, ollie, MONEY, 50, 1);
        vm.expectRevert(abi.encodeWithSelector(FamilyLedger.RefUsed.selector, r));
        ledger.award(r, ollie, MONEY, 50, 1);
        vm.expectRevert(abi.encodeWithSelector(FamilyLedger.RefUsed.selector, r));
        ledger.spendTime(r, ollie, 1, 1);
        vm.stopPrank();
        assertEq(ledger.balanceOf(ollie, MONEY), 50);
    }

    function test_noTransferAndNoApproval() public {
        vm.prank(signer);
        ledger.award(ref(), ollie, MONEY, 50, 1);
        vm.startPrank(ollie);
        vm.expectRevert(FamilyLedger.Soulbound.selector);
        ledger.safeTransferFrom(ollie, jamie, MONEY, 10, "");
        vm.expectRevert(FamilyLedger.Soulbound.selector);
        ledger.setApprovalForAll(jamie, true);
        uint256[] memory ids = new uint256[](1);
        uint256[] memory values = new uint256[](1);
        ids[0] = MONEY;
        values[0] = 10;
        vm.expectRevert(FamilyLedger.Soulbound.selector);
        ledger.safeBatchTransferFrom(ollie, jamie, ids, values, "");
        vm.stopPrank();
        assertEq(ledger.balanceOf(ollie, MONEY), 50);
    }

    function test_onlyTheSignerWrites() public {
        bytes32 minter = ledger.MINTER_ROLE();
        bytes32 burner = ledger.BURNER_ROLE();
        vm.startPrank(ollie);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, ollie, minter));
        ledger.award(ref(), ollie, MONEY, 5000, 1);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, ollie, burner));
        ledger.recordPayout(ref(), jamie, 1, 1);
        vm.stopPrank();
        // The cold key holds the admin role only, and writes nothing itself.
        assertTrue(ledger.hasRole(ledger.DEFAULT_ADMIN_ROLE(), admin));
        assertFalse(ledger.hasRole(minter, admin));
        assertFalse(ledger.hasRole(ledger.DEFAULT_ADMIN_ROLE(), signer));
    }

    function test_burnPathsAreFixed() public {
        vm.startPrank(signer);
        ledger.award(ref(), ollie, FLEX, 20, 1);
        ledger.award(ref(), ollie, MONEY, 50, 1);
        // MONEY never pays for screen time, and TIME is not a payout.
        vm.expectRevert();
        ledger.spendTime(ref(), ollie, 10, 2);
        vm.expectRevert();
        ledger.recordPayout(ref(), ollie, 51, 2);
        // FLEX converts only into MONEY or TIME, at the rate on chain.
        vm.expectRevert(abi.encodeWithSelector(FamilyLedger.WrongToken.selector, FLEX));
        ledger.convert(ref(), HOUSE, ollie, 5, FLEX, 5, 2);
        vm.expectRevert(abi.encodeWithSelector(FamilyLedger.WrongRate.selector, 10, 20));
        ledger.convert(ref(), HOUSE, ollie, 10, MONEY, 20, 2);
        vm.expectRevert(abi.encodeWithSelector(FamilyLedger.NoRate.selector, keccak256("other"), MONEY));
        ledger.convert(ref(), keccak256("other"), ollie, 10, MONEY, 10, 2);
        ledger.convert(ref(), HOUSE, ollie, 10, TIME, 10, 2);
        vm.stopPrank();
        assertEq(ledger.balanceOf(ollie, FLEX), 10);
        assertEq(ledger.balanceOf(ollie, TIME), 10);
    }

    function test_aCorrectionUndoesExactlyOnce() public {
        bytes32 job = ref();
        bytes32 conversion = ref();
        bytes32 session = ref();
        vm.startPrank(signer);
        ledger.allocateAllowance(ref(), ollie, 60, 1);
        ledger.award(job, ollie, FLEX, 20, 1);
        ledger.convert(conversion, HOUSE, ollie, 10, MONEY, 10, 2);
        ledger.spendTime(session, ollie, 30, 2);
        ledger.reverse(ref(), conversion, 3);
        assertEq(ledger.balanceOf(ollie, FLEX), 20);
        assertEq(ledger.balanceOf(ollie, MONEY), 0);
        vm.expectRevert(abi.encodeWithSelector(FamilyLedger.AlreadyReversed.selector, conversion));
        ledger.reverse(ref(), conversion, 3);
        // Spending, allowances and closes are not choices to undo.
        vm.expectRevert(abi.encodeWithSelector(FamilyLedger.NotReversible.selector, session));
        ledger.reverse(ref(), session, 3);
        // An unknown reference has nothing to undo.
        vm.expectRevert(abi.encodeWithSelector(FamilyLedger.NotReversible.selector, keccak256("nothing")));
        ledger.reverse(ref(), keccak256("nothing"), 3);
        ledger.reverse(ref(), job, 4);
        assertEq(ledger.balanceOf(ollie, FLEX), 0);
        vm.stopPrank();
    }

    function test_aCorrectionCannotTakeWhatIsGone() public {
        bytes32 job = ref();
        vm.startPrank(signer);
        ledger.award(job, ollie, MONEY, 50, 1);
        ledger.recordPayout(ref(), ollie, 50, 2);
        vm.expectRevert();
        ledger.reverse(ref(), job, 3);
        vm.stopPrank();
    }

    function test_aPayoutMarkedByMistakeComesBack() public {
        bytes32 payout = ref();
        vm.startPrank(signer);
        ledger.award(ref(), ollie, MONEY, 70, 1);
        ledger.recordPayout(payout, ollie, 70, 2);
        ledger.reverse(ref(), payout, 3);
        vm.stopPrank();
        assertEq(ledger.balanceOf(ollie, MONEY), 70);
    }

    function test_onlyChosenRefundsCanBeUndone() public {
        bytes32 rule = ref();
        bytes32 chosen = ref();
        vm.startPrank(signer);
        ledger.refund(rule, ollie, TIME, 15, false, 1);
        ledger.refund(chosen, ollie, FLEX, 10, true, 1);
        vm.expectRevert(abi.encodeWithSelector(FamilyLedger.NotReversible.selector, rule));
        ledger.reverse(ref(), rule, 2);
        ledger.reverse(ref(), chosen, 2);
        vm.stopPrank();
        assertEq(ledger.balanceOf(ollie, TIME), 15);
        assertEq(ledger.balanceOf(ollie, FLEX), 0);
    }

    function test_eventsCarryTheReference() public {
        bytes32 r = ref();
        vm.expectEmit(true, true, true, true);
        emit FamilyLedger.TaskRewarded(r, ollie, MONEY, 50, 7);
        vm.prank(signer);
        ledger.award(r, ollie, MONEY, 50, 7);
    }

    function testFuzz_awardThenReverseIsNoChange(uint8 idSeed, uint128 amount) public {
        uint256 id = (idSeed % 3) + 1;
        amount = uint128(bound(amount, 1, type(uint128).max));
        bytes32 job = ref();
        vm.startPrank(signer);
        ledger.award(job, ollie, id, amount, 1);
        ledger.reverse(ref(), job, 2);
        vm.stopPrank();
        assertEq(ledger.balanceOf(ollie, id), 0);
        assertEq(ledger.totalSupply(id), 0);
    }

    function testFuzz_spendNeverGoesBelowZero(uint32 given, uint32 spent) public {
        vm.startPrank(signer);
        ledger.allocateAllowance(ref(), ollie, given, 1);
        if (spent == 0) {
            vm.expectRevert(FamilyLedger.ZeroAmount.selector);
        } else if (spent > given) {
            vm.expectRevert();
        }
        ledger.spendTime(ref(), ollie, spent, 2);
        vm.stopPrank();
        assertLe(ledger.balanceOf(ollie, TIME), given);
    }

    function testFuzz_convertMatchesTheRate(uint16 points, uint8 each) public {
        points = uint16(bound(points, 1, type(uint16).max));
        each = uint8(bound(each, 1, type(uint8).max));
        vm.startPrank(signer);
        ledger.setRate(HOUSE, MONEY, each);
        ledger.award(ref(), ollie, FLEX, points, 1);
        ledger.convert(ref(), HOUSE, ollie, points, MONEY, uint256(points) * each, 2);
        vm.stopPrank();
        assertEq(ledger.balanceOf(ollie, MONEY), uint256(points) * each);
        assertEq(ledger.balanceOf(ollie, FLEX), 0);
    }
}
