#!/usr/bin/env bash
#
# Simulated players for PriceBetGame — drives N test wallets, placing a bet from each on every OPEN
# round and claiming winnings, so you can watch a realistic multi-player loop. For testing only.
#
#   ./sim-bettor.sh [durationSeconds]      # default 360s
#
# Wallet i bets bucket (i-1) % 6, so the wallets spread across all six buckets (A..F). After a round
# resolves it claims for every wallet that bet the winning bucket. The OPERATOR runs separately
# (operator.sh); this script only calls placeBet/claim, so it can't collide with the operator.
#
# Wallet keys come from a file of W1_PK/W2_PK/... (+ *_ADDRESS) lines:
#   TEST_WALLETS_FILE=/path/to/wallets ./sim-bettor.sh
# Default path: ./.testwallets  (gitignored — keep burner keys here, never commit them).
# Auto-tops-up each wallet from DEPLOYER_PRIVATE_KEY (in ../.env) when it drops below 2 MON.

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
# Discover wallets W1..WN and assign each a bucket (round-robin across the 6 buckets).
PKS=(); ADDRS=(); BKT=()
i=1
while :; do
  pk=$(eval echo "\${W${i}_PK:-}"); [ -z "$pk" ] && break
  PKS+=("$pk"); ADDRS+=("$(eval echo "\${W${i}_ADDRESS:-}")"); BKT+=( $(( (i-1) % 6 )) )
  i=$((i+1))
done
N=${#PKS[@]}
[ "$N" -gt 0 ] || { echo "no wallets found in $WALLETS_FILE"; exit 1; }

VALUE=$(cast call "$ADDR" 'betAmount()(uint256)' --rpc-url "$RPC" | sed 's/ .*//')
echo "sim-bettor: $ADDR | $N wallets | stake $(cast --to-unit "$VALUE" ether) MON/bet | running ${DURATION}s"
asg=""; for j in $(seq 0 $((N-1))); do asg="$asg W$((j+1))->${NAMES[${BKT[$j]}]}"; done
echo "  assignments:$asg"

round_field() { cast call "$ADDR" 'rounds(uint256)(uint64,uint64,bool,uint8,uint256,uint256,uint256)' "$1" --rpc-url "$RPC" 2>/dev/null | sed -n "${2}p"; }

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

  # claim resolved pending rounds
  still=""
  for r in $pending; do
    if [ "$(round_field "$r" 3)" = "true" ]; then
      w=$(round_field "$r" 4 | sed 's/ .*//'); claimed=0
      for j in $(seq 0 $((N-1))); do
        if [ "${BKT[$j]}" = "$w" ]; then
          cast send "$ADDR" "claim(uint256)" "$r" --rpc-url "$RPC" --private-key "${PKS[$j]}" >/dev/null 2>&1 && claimed=$((claimed+1))
        fi
      done
      pay=$(round_field "$r" 7 | sed 's/ .*//')
      echo "   round $r: bucket ${NAMES[$w]} won → $claimed wallet(s) claimed $(cast --to-unit "$pay" ether) MON each"
    else
      still="$still $r"
    fi
  done
  pending="$still"

  # bet on a freshly opened round
  if [ -n "$rid" ] && [ "$rid" != "0" ] && [ "$rid" != "$last_bet" ]; then
    resolved=$(round_field "$rid" 3); lock=$(round_field "$rid" 2 | sed 's/ .*//'); now=$(date +%s)
    if [ "$resolved" = "false" ] && [ -n "$lock" ] && [ "$now" -lt "$((lock-4))" ]; then
      for j in $(seq 0 $((N-1))); do topup "${ADDRS[$j]}"; done
      ok=0
      for j in $(seq 0 $((N-1))); do
        cast send "$ADDR" "placeBet(uint8)" "${BKT[$j]}" --value "$VALUE" --rpc-url "$RPC" --private-key "${PKS[$j]}" >/dev/null 2>&1 && ok=$((ok+1))
      done
      echo "round $rid open — placed $ok/$N bets across buckets"
      [ "$ok" -gt 0 ] && pending="$pending $rid"
      last_bet="$rid"
    fi
  fi
  sleep 2
done
echo "sim-bettor: done"
