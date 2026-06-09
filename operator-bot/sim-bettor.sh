#!/usr/bin/env bash
#
# Simulated players for PriceBetGame — drives N test wallets, each placing a WEIGHTED-RANDOM bet
# every open round and claiming winnings. Models realistic crowd behaviour: most players pile into
# the safe near-zero buckets, fewer take the mid buckets, and the long-shot extremes are rare.
# For testing only.
#
#   ./sim-bettor.sh [durationSeconds]      # default 360s
#
# Per-round bucket weights (sum 100):
#   C 30 + D 30  → 60%  (2.8× near-zero)
#   B 15 + E 15  → 30%  (10× mid)
#   A  5 + F  5  → 10%  (20× extremes, rare)
#
# The OPERATOR runs separately (operator.sh); this script only calls placeBet/claim, so it can't
# collide with the operator. Wallet keys come from W1_PK/W2_PK/... (+ *_ADDRESS) lines in:
#   TEST_WALLETS_FILE=/path/to/wallets ./sim-bettor.sh      (default ./.testwallets, gitignored)
# Auto-tops-up each wallet from DEPLOYER_PRIVATE_KEY (../.env) when it drops below 2 MON.

set -uo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"

set -a; source ../.env 2>/dev/null || true; set +a
RPC="${MONAD_RPC:-https://rpc.monad.xyz}"
ADDR="${PRICEBETGAME_ADDRESS:?set PRICEBETGAME_ADDRESS in ../.env}"
WALLETS_FILE="${TEST_WALLETS_FILE:-./.testwallets}"
DURATION="${1:-360}"

[ -f "$WALLETS_FILE" ] || { echo "no wallets file at $WALLETS_FILE (set TEST_WALLETS_FILE)"; exit 1; }
set -a; source "$WALLETS_FILE"; set +a

NAMES=(A B C D E F)
PKS=(); ADDRS=()
i=1
while :; do
  pk=$(eval echo "\${W${i}_PK:-}"); [ -z "$pk" ] && break
  PKS+=("$pk"); ADDRS+=("$(eval echo "\${W${i}_ADDRESS:-}")"); i=$((i+1))
done
N=${#PKS[@]}
[ "$N" -gt 0 ] || { echo "no wallets found in $WALLETS_FILE"; exit 1; }

VALUE=$(cast call "$ADDR" 'betAmount()(uint256)' --rpc-url "$RPC" | sed 's/ .*//')
echo "sim-bettor: $ADDR | $N wallets | stake $(cast --to-unit "$VALUE" ether) MON/bet | weighted bets (C/D 60%, B/E 30%, A/F 10%) | ${DURATION}s"

round_field() { cast call "$ADDR" 'rounds(uint256)(uint64,uint64,bool,uint8,uint256,uint256,uint256)' "$1" --rpc-url "$RPC" 2>/dev/null | sed -n "${2}p"; }

# Weighted-random bucket: C30 D30 B15 E15 A5 F5
pick_bucket() {
  local r=$((RANDOM % 100))
  if   [ "$r" -lt 30 ]; then echo 2   # C
  elif [ "$r" -lt 60 ]; then echo 3   # D
  elif [ "$r" -lt 75 ]; then echo 1   # B
  elif [ "$r" -lt 90 ]; then echo 4   # E
  elif [ "$r" -lt 95 ]; then echo 0   # A
  else                       echo 5   # F
  fi
}

TOPUP_WARNED=0
topup() {
  local A="$1"
  [ -z "${DEPLOYER_PRIVATE_KEY:-}" ] && { [ "$TOPUP_WARNED" = 0 ] && { echo "   (no DEPLOYER_PRIVATE_KEY — no auto-refill)"; TOPUP_WARNED=1; }; return; }
  local bal; bal=$(cast balance --rpc-url "$RPC" "$A" 2>/dev/null || echo 0)
  if [ "$(python3 -c "print(1 if $bal < 2*10**18 else 0)")" = "1" ]; then
    local need; need=$(python3 -c "print(6*10**18 - $bal)")
    cast send "$A" --value "$need" --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null 2>&1 || true
  fi
}

last_bet=0; pending=""
endts=$(( $(date +%s) + DURATION ))
while [ "$(date +%s)" -lt "$endts" ]; do
  rid=$(cast call "$ADDR" 'currentRoundId()(uint256)' --rpc-url "$RPC" 2>/dev/null || echo 0)

  # claim winnings on resolved pending rounds (attempt all wallets; non-winners revert free)
  still=""
  for r in $pending; do
    if [ "$(round_field "$r" 3)" = "true" ]; then
      w=$(round_field "$r" 4 | sed 's/ .*//'); claimed=0
      for j in $(seq 0 $((N-1))); do
        cast send "$ADDR" "claim(uint256)" "$r" --rpc-url "$RPC" --private-key "${PKS[$j]}" >/dev/null 2>&1 && claimed=$((claimed+1))
      done
      pay=$(round_field "$r" 7 | sed 's/ .*//')
      echo "   round $r: bucket ${NAMES[$w]} won → $claimed wallet(s) claimed $(cast --to-unit "$pay" ether) MON each"
    else
      still="$still $r"
    fi
  done
  pending="$still"

  # weighted-random bets on a freshly opened round
  if [ -n "$rid" ] && [ "$rid" != "0" ] && [ "$rid" != "$last_bet" ]; then
    resolved=$(round_field "$rid" 3); lock=$(round_field "$rid" 2 | sed 's/ .*//'); now=$(date +%s)
    if [ "$resolved" = "false" ] && [ -n "$lock" ] && [ "$now" -lt "$((lock-4))" ]; then
      declare -a tally=(0 0 0 0 0 0); ok=0
      for j in $(seq 0 $((N-1))); do
        topup "${ADDRS[$j]}"
        b=$(pick_bucket)
        if cast send "$ADDR" "placeBet(uint8)" "$b" --value "$VALUE" --rpc-url "$RPC" --private-key "${PKS[$j]}" >/dev/null 2>&1; then
          ok=$((ok+1)); tally[$b]=$((tally[$b]+1))
        fi
      done
      echo "round $rid open — placed $ok/$N bets → A:${tally[0]} B:${tally[1]} C:${tally[2]} D:${tally[3]} E:${tally[4]} F:${tally[5]}"
      [ "$ok" -gt 0 ] && pending="$pending $rid"
      last_bet="$rid"
    fi
  fi
  sleep 2
done
echo "sim-bettor: done"
