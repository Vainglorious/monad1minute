// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PriceBetGame
/// @notice Fixed-odds betting on short-window BTC/USD price movement, settled by a trusted operator.
///         Players stake a flat amount on one of six outcome buckets per round. The two extreme
///         buckets pay more than the four middle buckets. House-funded with structural solvency.
/// @dev Self-contained: inline ownership + reentrancy guard, no external dependencies.
contract PriceBetGame {
    // ----------------------------------------------------------------------------------
    // Types
    // ----------------------------------------------------------------------------------

    /// @dev Outcome buckets by signed basis-point price change (0.1% = 10 bps).
    ///      A: bps > 10          (extreme, up)
    ///      B: 5  < bps <= 10    (middle)
    ///      C: 0  <= bps <= 5    (middle)  -- exactly 0% lands here
    ///      D: -5 <= bps < 0     (middle)
    ///      E: -10 <= bps < -5   (middle)
    ///      F: bps < -10         (extreme, down)
    enum Bucket {
        A,
        B,
        C,
        D,
        E,
        F
    }

    struct Round {
        uint64 startTime;
        uint64 lockTime; // bets accepted while block.timestamp < lockTime
        bool resolved;
        Bucket winner;
        uint256 betCount; // total bets placed this round
        uint256 winnerCount; // set at resolve
        uint256 payoutPerWinner; // set at resolve (0 until resolved)
    }

    struct Bet {
        Bucket bucket;
        bool placed;
        bool claimed;
    }

    // ----------------------------------------------------------------------------------
    // Storage
    // ----------------------------------------------------------------------------------

    address public owner;
    address public operator;

    uint256 public betAmount = 10 ether; // flat stake per bet (10 MON)
    uint256 public extremeMultiplier = 5; // total return multiplier for extreme buckets (A, F)
    uint256 public middleMultiplier = 2; // total return multiplier for middle buckets (B, C, D, E)
    uint64 public bettingDuration = 60; // seconds the betting window stays open

    uint256 public currentRoundId; // 0 means "no round started yet"
    bool private roundActive; // a round exists and is not yet resolved

    /// @notice Total worst-case payout currently reserved against the balance (solvency guard).
    uint256 public reserved;

    /// @notice Per-bucket bet counts for a round, used to size winner liability at resolve.
    mapping(uint256 => mapping(uint8 => uint256)) public bucketCount;

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => Bet)) public bets;

    uint256 private _reentrancyLock = 1; // 1 = unlocked, 2 = locked

    // ----------------------------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------------------------

    event RoundStarted(uint256 indexed roundId, uint64 startTime, uint64 lockTime);
    event BetPlaced(uint256 indexed roundId, address indexed player, Bucket bucket, uint256 amount);
    event RoundResolved(
        uint256 indexed roundId, int256 priceChangeBps, Bucket winner, uint256 winnerCount, uint256 payoutPerWinner
    );
    event Claimed(uint256 indexed roundId, address indexed player, uint256 amount);
    event HouseFunded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event OperatorChanged(address indexed operator);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ConfigChanged(uint256 betAmount, uint256 extremeMultiplier, uint256 middleMultiplier, uint64 bettingDuration);

    // ----------------------------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyLock == 1, "reentrant");
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
    }

    constructor(address _operator) {
        owner = msg.sender;
        operator = _operator == address(0) ? msg.sender : _operator;
        emit OwnershipTransferred(address(0), msg.sender);
        emit OperatorChanged(operator);
    }

    // ----------------------------------------------------------------------------------
    // Round lifecycle
    // ----------------------------------------------------------------------------------

    /// @notice Open a new betting round. Reverts if a round is live and unresolved.
    function startRound() external onlyOperator returns (uint256 roundId) {
        require(!roundActive, "round active");
        roundActive = true;
        roundId = ++currentRoundId;

        uint64 nowTs = uint64(block.timestamp);
        rounds[roundId] = Round({
            startTime: nowTs,
            lockTime: nowTs + bettingDuration,
            resolved: false,
            winner: Bucket.A,
            betCount: 0,
            winnerCount: 0,
            payoutPerWinner: 0
        });

        emit RoundStarted(roundId, nowTs, nowTs + bettingDuration);
    }

    /// @notice Place a single bet on one bucket for the current round. Exactly `betAmount` must be sent.
    function placeBet(Bucket bucket) external payable {
        require(roundActive, "no active round");
        uint256 roundId = currentRoundId;
        Round storage r = rounds[roundId];

        require(block.timestamp < r.lockTime, "betting closed");
        require(msg.value == betAmount, "wrong stake");

        Bet storage b = bets[roundId][msg.sender];
        require(!b.placed, "already bet");

        b.bucket = bucket;
        b.placed = true;

        r.betCount += 1;
        bucketCount[roundId][uint8(bucket)] += 1;

        // Reserve worst-case payout (extreme) for this bet. The incoming stake is already part of
        // the balance, so the house bankroll must cover the remainder or this reverts.
        reserved += betAmount * extremeMultiplier;
        require(address(this).balance >= reserved, "house underfunded");

        emit BetPlaced(roundId, msg.sender, bucket, msg.value);
    }

    /// @notice Settle the current round with the observed signed price change in basis points.
    function resolveRound(int256 priceChangeBps) external onlyOperator {
        require(roundActive, "no active round");
        uint256 roundId = currentRoundId;
        Round storage r = rounds[roundId];

        require(block.timestamp >= r.lockTime, "betting open");
        require(!r.resolved, "already resolved");

        Bucket winner = classify(priceChangeBps);
        uint256 winnerCount = bucketCount[roundId][uint8(winner)];
        uint256 multiplier = isExtreme(winner) ? extremeMultiplier : middleMultiplier;
        uint256 payoutPerWinner = betAmount * multiplier;

        // Release this round's worst-case reservation, then re-reserve actual winner liability.
        uint256 worstCase = r.betCount * betAmount * extremeMultiplier;
        reserved = reserved - worstCase + (winnerCount * payoutPerWinner);

        r.resolved = true;
        r.winner = winner;
        r.winnerCount = winnerCount;
        r.payoutPerWinner = payoutPerWinner;
        roundActive = false;

        emit RoundResolved(roundId, priceChangeBps, winner, winnerCount, payoutPerWinner);
    }

    /// @notice Winners pull their payout for a resolved round.
    function claim(uint256 roundId) external nonReentrant {
        Round storage r = rounds[roundId];
        require(r.resolved, "not resolved");

        Bet storage b = bets[roundId][msg.sender];
        require(b.placed, "no bet");
        require(!b.claimed, "already claimed");
        require(b.bucket == r.winner, "not a winner");

        b.claimed = true;
        uint256 amount = r.payoutPerWinner;
        reserved -= amount;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");

        emit Claimed(roundId, msg.sender, amount);
    }

    // ----------------------------------------------------------------------------------
    // Classification (pure)
    // ----------------------------------------------------------------------------------

    /// @notice Map a signed basis-point price change to its outcome bucket.
    function classify(int256 bps) public pure returns (Bucket) {
        if (bps > 10) return Bucket.A;
        if (bps > 5) return Bucket.B; // 5 < bps <= 10
        if (bps >= 0) return Bucket.C; // 0 <= bps <= 5
        if (bps >= -5) return Bucket.D; // -5 <= bps < 0
        if (bps >= -10) return Bucket.E; // -10 <= bps < -5
        return Bucket.F; // bps < -10
    }

    /// @notice True for the two tail buckets (A and F), which pay the extreme multiplier.
    function isExtreme(Bucket bucket) public pure returns (bool) {
        return bucket == Bucket.A || bucket == Bucket.F;
    }

    // ----------------------------------------------------------------------------------
    // Bankroll
    // ----------------------------------------------------------------------------------

    /// @notice Add to the house bankroll.
    function fundHouse() external payable {
        emit HouseFunded(msg.sender, msg.value);
    }

    receive() external payable {
        emit HouseFunded(msg.sender, msg.value);
    }

    /// @notice Withdraw free (unreserved) funds only. Reserved player liability can never be pulled.
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= address(this).balance - reserved, "exceeds free balance");
        (bool ok,) = payable(owner).call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(owner, amount);
    }

    /// @notice Free (withdrawable) balance = total balance minus reserved liability.
    function freeBalance() external view returns (uint256) {
        return address(this).balance - reserved;
    }

    // ----------------------------------------------------------------------------------
    // Admin / config (only while no round is live)
    // ----------------------------------------------------------------------------------

    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "zero operator");
        operator = _operator;
        emit OperatorChanged(_operator);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setBetAmount(uint256 _betAmount) external onlyOwner {
        require(!roundActive, "round active");
        require(_betAmount > 0, "zero bet");
        betAmount = _betAmount;
        emit ConfigChanged(betAmount, extremeMultiplier, middleMultiplier, bettingDuration);
    }

    function setMultipliers(uint256 _extreme, uint256 _middle) external onlyOwner {
        require(!roundActive, "round active");
        require(_extreme >= 1 && _middle >= 1, "multiplier < 1");
        extremeMultiplier = _extreme;
        middleMultiplier = _middle;
        emit ConfigChanged(betAmount, extremeMultiplier, middleMultiplier, bettingDuration);
    }

    function setBettingDuration(uint64 _seconds) external onlyOwner {
        require(!roundActive, "round active");
        require(_seconds > 0, "zero duration");
        bettingDuration = _seconds;
        emit ConfigChanged(betAmount, extremeMultiplier, middleMultiplier, bettingDuration);
    }
}
