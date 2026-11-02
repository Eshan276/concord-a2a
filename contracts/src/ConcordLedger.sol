// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ConcordLedger
/// @notice Public trust layer for the Concord agent-to-agent trade protocol on HashKey Chain.
///         - Registry: which company runs which agents, and the only payee address its mandates may use.
///         - Settlements: every HSP-settled trade (cart hash, HSP payment request id, price vs. fair reference).
///         - Fair price index: last settled reference price per SKU, read by agents for the fair-price band.
///         - Reputation: trades, volume and fair-dealing rule violations per company.
/// @dev Writes come from protocol operators (the Concord engine relayer). Reads are open to any agent.
contract ConcordLedger {
    enum Role { None, Buyer, Seller, Both }

    struct Company {
        string name;
        address payee;
        Role role;
        bool active;
        uint64 trades;
        uint64 violations;
        uint128 volumeMicros; // USD × 1e6
        uint64 registeredAt;
    }

    struct Settlement {
        bytes32 dealId;
        bytes32 buyer;
        bytes32 seller;
        bytes32 sku;
        uint64 qty;
        uint64 unitPriceMicros;
        uint64 refPriceMicros;
        bytes32 cartHash;
        uint64 timestamp;
        string paymentRequestId;
        string hspTx;
    }

    address public owner;
    mapping(address => bool) public operators;

    mapping(bytes32 => Company) public companies;
    bytes32[] public companyIds;

    Settlement[] public settlements;
    mapping(bytes32 => bool) public settled; // dealId → recorded (idempotency)
    mapping(bytes32 => uint64) public refPriceMicros; // sku → fair reference price

    event OperatorSet(address indexed operator, bool enabled);
    event CompanyRegistered(bytes32 indexed id, string name, address payee, Role role);
    event PayeeUpdated(bytes32 indexed id, address payee);
    event Settled(
        bytes32 indexed dealId, bytes32 indexed buyer, bytes32 indexed seller, bytes32 sku,
        uint64 qty, uint64 unitPriceMicros, uint64 refPriceMicros, bytes32 cartHash, string paymentRequestId, string hspTx
    );
    event RefPriceUpdated(bytes32 indexed sku, uint64 priceMicros);
    event ViolationReported(bytes32 indexed company, bytes32 indexed dealId, string rule, address reporter);

    error NotOwner();
    error NotOperator();
    error UnknownCompany(bytes32 id);
    error AlreadySettled(bytes32 dealId);
    error ZeroPayee();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (!operators[msg.sender]) revert NotOperator();
        _;
    }

    constructor() {
        owner = msg.sender;
        operators[msg.sender] = true;
        emit OperatorSet(msg.sender, true);
    }

    function setOperator(address op, bool enabled) external onlyOwner {
        operators[op] = enabled;
        emit OperatorSet(op, enabled);
    }

    function transferOwnership(address next) external onlyOwner {
        owner = next;
    }

    // ---------------------------------------------------------------- registry

    function registerCompany(bytes32 id, string calldata name, address payee, uint8 role) external onlyOperator {
        if (payee == address(0)) revert ZeroPayee();
        Company storage c = companies[id];
        if (c.registeredAt == 0) {
            companyIds.push(id);
            c.registeredAt = uint64(block.timestamp);
        }
        c.name = name;
        c.payee = payee;
        c.role = Role(role);
        c.active = true;
        emit CompanyRegistered(id, name, payee, Role(role));
    }

    function setActive(bytes32 id, bool active) external onlyOperator {
        if (companies[id].registeredAt == 0) revert UnknownCompany(id);
        companies[id].active = active;
    }

    /// @notice The only address a company's payment mandates may name as pay_to.
    function payeeOf(bytes32 id) external view returns (address) {
        return companies[id].payee;
    }

    function companyCount() external view returns (uint256) {
        return companyIds.length;
    }

    // ---------------------------------------------------------------- settlements

    function recordSettlement(
        bytes32 dealId,
        bytes32 buyer,
        bytes32 seller,
        bytes32 sku,
        uint64 qty,
        uint64 unitPriceMicros,
        uint64 newRefPriceMicros,
        bytes32 cartHash,
        string calldata paymentRequestId,
        string calldata hspTx
    ) external onlyOperator {
        if (settled[dealId]) revert AlreadySettled(dealId);
        if (companies[buyer].registeredAt == 0) revert UnknownCompany(buyer);
        if (companies[seller].registeredAt == 0) revert UnknownCompany(seller);
        settled[dealId] = true;

        settlements.push(Settlement({
            dealId: dealId, buyer: buyer, seller: seller, sku: sku, qty: qty,
            unitPriceMicros: unitPriceMicros, refPriceMicros: newRefPriceMicros, cartHash: cartHash,
            timestamp: uint64(block.timestamp), paymentRequestId: paymentRequestId, hspTx: hspTx
        }));

        uint128 value = uint128(qty) * uint128(unitPriceMicros);
        companies[buyer].trades += 1;
        companies[buyer].volumeMicros += value;
        companies[seller].trades += 1;
        companies[seller].volumeMicros += value;

        refPriceMicros[sku] = newRefPriceMicros;
        emit Settled(dealId, buyer, seller, sku, qty, unitPriceMicros, newRefPriceMicros, cartHash, paymentRequestId, hspTx);
        emit RefPriceUpdated(sku, newRefPriceMicros);
    }

    function settlementCount() external view returns (uint256) {
        return settlements.length;
    }

    // ---------------------------------------------------------------- reputation

    function reportViolation(bytes32 company, bytes32 dealId, string calldata rule) external onlyOperator {
        if (companies[company].registeredAt == 0) revert UnknownCompany(company);
        companies[company].violations += 1;
        emit ViolationReported(company, dealId, rule, msg.sender);
    }

    /// @notice Simple reputation score in basis points: share of interactions without violations.
    function reputationBps(bytes32 id) external view returns (uint256) {
        Company storage c = companies[id];
        uint256 total = uint256(c.trades) + uint256(c.violations);
        if (total == 0) return 10_000;
        return (uint256(c.trades) * 10_000) / total;
    }
}
