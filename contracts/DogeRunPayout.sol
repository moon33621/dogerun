// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title DogeRunPayout
/// @notice Holds $DRUN and pays a wallet when it receives a claim signed by the game server.
///         `dailyLimit` is in token base units (18 decimals). It resets every UTC day.
///         Fund the contract by transferring $DRUN to its address. The signer key
///         never holds the tokens.
contract DogeRunPayout {
    bytes32 public constant CLAIM_TAG = keccak256("DRUN_CLAIM_V1");

    IERC20 public immutable token;
    address public signer;
    address public owner;
    uint256 public dailyLimit;
    uint256 public dayIndex;
    uint256 public spentToday;
    mapping(bytes32 => bool) public used;

    event Claimed(address indexed to, uint256 amount, bytes32 indexed digest);
    event SignerUpdated(address indexed signer);
    event DailyLimitUpdated(uint256 limit);

    error NotOwner();
    error BadClaim();
    error Expired();
    error Used();
    error BadSigner();
    error DailyLimit();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address token_, address signer_, uint256 dailyLimit_) {
        if (token_ == address(0) || signer_ == address(0) || dailyLimit_ == 0) revert BadClaim();
        token = IERC20(token_);
        signer = signer_;
        owner = msg.sender;
        dailyLimit = dailyLimit_;
    }

    function claim(address to, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata signature) external {
        if (to == address(0) || amount == 0) revert BadClaim();
        if (block.timestamp > deadline) revert Expired();

        bytes32 digest = keccak256(
            abi.encode(CLAIM_TAG, to, amount, nonce, deadline, address(this), block.chainid)
        );
        if (used[digest]) revert Used();
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        if (_recover(ethHash, signature) != signer) revert BadSigner();

        uint256 day = block.timestamp / 1 days;
        if (day != dayIndex) {
            dayIndex = day;
            spentToday = 0;
        }
        if (spentToday + amount > dailyLimit) revert DailyLimit();

        used[digest] = true;
        spentToday += amount;
        if (!token.transfer(to, amount)) revert TransferFailed();
        emit Claimed(to, amount, digest);
    }

    function setSigner(address next) external onlyOwner {
        if (next == address(0)) revert BadClaim();
        signer = next;
        emit SignerUpdated(next);
    }

    function setDailyLimit(uint256 limit) external onlyOwner {
        if (limit == 0) revert BadClaim();
        dailyLimit = limit;
        emit DailyLimitUpdated(limit);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert BadClaim();
        owner = next;
    }

    /// @notice Pull tokens back to the owner. Player claims still obey `dailyLimit`.
    function rescue(address to, uint256 amount) external onlyOwner {
        if (to == address(0) || amount == 0) revert BadClaim();
        if (!token.transfer(to, amount)) revert TransferFailed();
    }

    function _recover(bytes32 hash, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(hash, v, r, s);
    }
}
