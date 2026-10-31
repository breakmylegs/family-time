// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.38;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title A family's ledger of screen time, pocket money and flex points (brief Part 7, ADR 0014).
/// @notice Tokens are soulbound: they are only ever minted to a child or burned from one, never
/// moved. Each kind of entry has its own function, and the burn paths are fixed: TIME burns only
/// by a planned session or the week's close, MONEY only by a payout, FLEX only by a conversion at
/// the household's rate. There is no general burn, so no deduction can be written, not even by
/// the backend signer. A correction undoes exactly one earlier entry, once.
/// @dev Immutable and versioned: no proxy. A new version is deployed and the history replayed
/// from Postgres. Every entry carries a reference (the keccak of the app's ref) that can be used
/// once. The event names are the reason codes.
contract FamilyLedger is ERC1155Supply, AccessControl {
    string public constant VERSION = "1";

    uint256 public constant TIME = 1; // minutes
    uint256 public constant MONEY = 2; // pence
    uint256 public constant FLEX = 3; // points

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant RATES_ROLE = keccak256("RATES_ROLE");

    /// @notice What an entry did to a child's balances, kept so a correction can undo exactly that.
    struct Effect {
        address child;
        int256 time;
        int256 money;
        int256 flex;
        bool reversible;
        bool reversed;
    }

    /// @notice References already used. Using one again reverts.
    mapping(bytes32 ref => bool) public used;
    mapping(bytes32 ref => Effect) private _effects;
    /// @notice What one flex point becomes in a household: pence (MONEY) or minutes (TIME).
    mapping(bytes32 household => mapping(uint256 id => uint256 amount)) public rate;

    error Soulbound();
    error RefUsed(bytes32 ref);
    error ZeroAmount();
    error WrongToken(uint256 id);
    error NoRate(bytes32 household, uint256 id);
    error WrongRate(uint256 expected, uint256 given);
    error NotReversible(bytes32 ref);
    error AlreadyReversed(bytes32 ref);

    event AllowanceAllocated(bytes32 indexed ref, address indexed child, uint256 mins, uint64 at);
    event TaskRewarded(bytes32 indexed ref, address indexed child, uint256 indexed id, uint256 amount, uint64 at);
    event TimeSpent(bytes32 indexed ref, address indexed child, uint256 mins, uint64 at);
    event Refunded(bytes32 indexed ref, address indexed child, uint256 indexed id, uint256 amount, bool chosen, uint64 at);
    event Converted(bytes32 indexed ref, address indexed child, uint256 points, uint256 toId, uint256 amount, uint64 at);
    event WeekClosed(bytes32 indexed ref, address indexed child, uint256 expiredMinutes, uint256 bonusPence, uint64 at);
    event PayoutRecorded(bytes32 indexed ref, address indexed child, uint256 pence, uint64 at);
    event Reversed(bytes32 indexed ref, address indexed child, bytes32 indexed original, int256 time, int256 money, int256 flex, uint64 at);
    event RateSet(bytes32 indexed household, uint256 indexed id, uint256 amount);

    /// @param admin The cold key's address. Only its address is needed: it never has to sign.
    /// @param signer The backend signer, which writes every entry.
    constructor(address admin, address signer) ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, signer);
        _grantRole(BURNER_ROLE, signer);
        _grantRole(RATES_ROLE, signer);
    }

    modifier fresh(bytes32 ref) {
        if (used[ref]) revert RefUsed(ref);
        used[ref] = true;
        _;
    }

    modifier mintsAndBurns() {
        _checkRole(MINTER_ROLE);
        _checkRole(BURNER_ROLE);
        _;
    }

    // ------------------------------------------------------------------------------------------
    // Entries

    /// @notice The week's screen time, at the reset. Zero is allowed: an allowance can be 0.
    function allocateAllowance(bytes32 ref, address child, uint256 mins, uint64 at) external onlyRole(MINTER_ROLE) fresh(ref) {
        _mint(child, TIME, mins, "");
        _record(ref, child, _signed(mins), 0, 0, false);
        emit AllowanceAllocated(ref, child, mins, at);
    }

    /// @notice A job paid in screen time, pocket money or flex points.
    function award(bytes32 ref, address child, uint256 id, uint256 amount, uint64 at) external onlyRole(MINTER_ROLE) fresh(ref) {
        _token(id);
        _positive(amount);
        _mint(child, id, amount, "");
        _record(ref, child, id == TIME ? _signed(amount) : int256(0), id == MONEY ? _signed(amount) : int256(0), id == FLEX ? _signed(amount) : int256(0), true);
        emit TaskRewarded(ref, child, id, amount, at);
    }

    /// @notice A planned session, or a counted Allow: the only way TIME is spent.
    function spendTime(bytes32 ref, address child, uint256 mins, uint64 at) external onlyRole(BURNER_ROLE) fresh(ref) {
        _positive(mins);
        _burn(child, TIME, mins);
        _record(ref, child, -_signed(mins), 0, 0, false);
        emit TimeSpent(ref, child, mins, at);
    }

    /// @notice Minutes the rules give back (a Block during a session), or points a parent chose to
    /// give. Only the chosen kind can be undone.
    function refund(bytes32 ref, address child, uint256 id, uint256 amount, bool chosen, uint64 at) external onlyRole(MINTER_ROLE) fresh(ref) {
        _token(id);
        _positive(amount);
        _mint(child, id, amount, "");
        _record(ref, child, id == TIME ? _signed(amount) : int256(0), id == MONEY ? _signed(amount) : int256(0), id == FLEX ? _signed(amount) : int256(0), chosen);
        emit Refunded(ref, child, id, amount, chosen, at);
    }

    /// @notice Flex points into pocket money or screen time, at the household's rate on chain.
    function convert(bytes32 ref, bytes32 household, address child, uint256 points, uint256 toId, uint256 amount, uint64 at) external mintsAndBurns fresh(ref) {
        if (toId != MONEY && toId != TIME) revert WrongToken(toId);
        _positive(points);
        uint256 each = rate[household][toId];
        if (each == 0) revert NoRate(household, toId);
        if (amount != points * each) revert WrongRate(points * each, amount);
        _burn(child, FLEX, points);
        _mint(child, toId, amount, "");
        _record(ref, child, toId == TIME ? _signed(amount) : int256(0), toId == MONEY ? _signed(amount) : int256(0), -_signed(points), true);
        emit Converted(ref, child, points, toId, amount, at);
    }

    /// @notice The week's end: the TIME left expires, and the bonus (if any) becomes pocket money.
    function closeWeek(bytes32 ref, address child, uint256 expiredMinutes, uint256 bonusPence, uint64 at) external mintsAndBurns fresh(ref) {
        if (expiredMinutes > 0) _burn(child, TIME, expiredMinutes);
        if (bonusPence > 0) _mint(child, MONEY, bonusPence, "");
        _record(ref, child, -_signed(expiredMinutes), _signed(bonusPence), 0, false);
        emit WeekClosed(ref, child, expiredMinutes, bonusPence, at);
    }

    /// @notice Pocket money handed over: the only way MONEY is burned.
    function recordPayout(bytes32 ref, address child, uint256 pence, uint64 at) external onlyRole(BURNER_ROLE) fresh(ref) {
        _positive(pence);
        _burn(child, MONEY, pence);
        _record(ref, child, 0, -_signed(pence), 0, true);
        emit PayoutRecorded(ref, child, pence, at);
    }

    /// @notice Fix a mistake: exactly the opposite of one earlier award, conversion, payout or chosen
    /// refund, once. A burn here can never take more than the original added.
    function reverse(bytes32 ref, bytes32 original, uint64 at) external mintsAndBurns fresh(ref) {
        Effect storage e = _effects[original];
        if (!e.reversible) revert NotReversible(original);
        if (e.reversed) revert AlreadyReversed(original);
        e.reversed = true;
        _undo(e.child, TIME, e.time);
        _undo(e.child, MONEY, e.money);
        _undo(e.child, FLEX, e.flex);
        _record(ref, e.child, -e.time, -e.money, -e.flex, false);
        emit Reversed(ref, e.child, original, -e.time, -e.money, -e.flex, at);
    }

    /// @notice What one flex point becomes in a household. Set by the signer, never by the cold key,
    /// so a change in Settings does not need it; every change is an event.
    function setRate(bytes32 household, uint256 id, uint256 amount) external onlyRole(RATES_ROLE) {
        if (id != MONEY && id != TIME) revert WrongToken(id);
        rate[household][id] = amount;
        emit RateSet(household, id, amount);
    }

    // ------------------------------------------------------------------------------------------
    // Reads

    /// @notice What an entry did, and whether it can still be undone.
    function effectOf(bytes32 ref) external view returns (Effect memory) {
        return _effects[ref];
    }

    // ------------------------------------------------------------------------------------------
    // Soulbound

    /// @dev Only mints (from zero) and burns (to zero). Any transfer between accounts reverts.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0) && to != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }

    /// @notice Nobody can be approved to move a child's tokens.
    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // ------------------------------------------------------------------------------------------
    // Internals

    function _record(bytes32 ref, address child, int256 time, int256 money, int256 flex, bool reversible) private {
        _effects[ref] = Effect(child, time, money, flex, reversible, false);
    }

    /// @dev Undo one part of an effect: what was added is burned, what was taken is minted back.
    function _undo(address child, uint256 id, int256 amount) private {
        if (amount > 0) _burn(child, id, uint256(amount));
        else if (amount < 0) _mint(child, id, uint256(-amount), "");
    }

    function _token(uint256 id) private pure {
        if (id != TIME && id != MONEY && id != FLEX) revert WrongToken(id);
    }

    function _positive(uint256 amount) private pure {
        if (amount == 0) revert ZeroAmount();
    }

    /// @dev Reverts rather than wrapping, so a stored effect is always the exact amount.
    function _signed(uint256 amount) private pure returns (int256) {
        return SafeCast.toInt256(amount);
    }
}
