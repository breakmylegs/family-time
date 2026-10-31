// The contract's interface, by hand, so the laptop can type-check against it without Foundry. A
// test in the image's real-chain stage checks it against what forge compiled
// (contracts/src/FamilyLedger.sol); the two must never drift.
import { parseAbi } from 'viem';

export const familyLedgerAbi = parseAbi([
  'constructor(address admin, address signer)',
  'function VERSION() view returns (string)',
  'function used(bytes32 ref) view returns (bool)',
  'function rate(bytes32 household, uint256 id) view returns (uint256)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function totalSupply(uint256 id) view returns (uint256)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function allocateAllowance(bytes32 ref, address child, uint256 mins, uint64 at)',
  'function award(bytes32 ref, address child, uint256 id, uint256 amount, uint64 at)',
  'function spendTime(bytes32 ref, address child, uint256 mins, uint64 at)',
  'function refund(bytes32 ref, address child, uint256 id, uint256 amount, bool chosen, uint64 at)',
  'function convert(bytes32 ref, bytes32 household, address child, uint256 points, uint256 toId, uint256 amount, uint64 at)',
  'function closeWeek(bytes32 ref, address child, uint256 expiredMinutes, uint256 bonusPence, uint64 at)',
  'function recordPayout(bytes32 ref, address child, uint256 pence, uint64 at)',
  'function reverse(bytes32 ref, bytes32 original, uint64 at)',
  'function setRate(bytes32 household, uint256 id, uint256 amount)',
  'event AllowanceAllocated(bytes32 indexed ref, address indexed child, uint256 mins, uint64 at)',
  'event TaskRewarded(bytes32 indexed ref, address indexed child, uint256 indexed id, uint256 amount, uint64 at)',
  'event TimeSpent(bytes32 indexed ref, address indexed child, uint256 mins, uint64 at)',
  'event Refunded(bytes32 indexed ref, address indexed child, uint256 indexed id, uint256 amount, bool chosen, uint64 at)',
  'event Converted(bytes32 indexed ref, address indexed child, uint256 points, uint256 toId, uint256 amount, uint64 at)',
  'event WeekClosed(bytes32 indexed ref, address indexed child, uint256 expiredMinutes, uint256 bonusPence, uint64 at)',
  'event PayoutRecorded(bytes32 indexed ref, address indexed child, uint256 pence, uint64 at)',
  'event Reversed(bytes32 indexed ref, address indexed child, bytes32 indexed original, int256 time, int256 money, int256 flex, uint64 at)',
  'event RateSet(bytes32 indexed household, uint256 indexed id, uint256 amount)',
  'error Soulbound()',
  'error RefUsed(bytes32 ref)',
  'error ZeroAmount()',
  'error WrongToken(uint256 id)',
  'error NoRate(bytes32 household, uint256 id)',
  'error WrongRate(uint256 expected, uint256 given)',
  'error NotReversible(bytes32 ref)',
  'error AlreadyReversed(bytes32 ref)',
  'error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)',
  'error ERC1155InsufficientBalance(address sender, uint256 balance, uint256 needed, uint256 tokenId)',
]);

/** Token ids, as in the contract. */
export const TOKEN = { TIME: 1n, MONEY: 2n, FLEX: 3n } as const;

/** The contract's version this code writes to. A new contract version means a new row and a replay. */
export const CONTRACT_VERSION = '1';
