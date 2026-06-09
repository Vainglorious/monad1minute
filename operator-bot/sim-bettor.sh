#!/usr/bin/env bash
#
# Simulated players for PriceBetGame — places test bets on each OPEN round AND claims winnings,
# so you can watch a full player loop: bet -> resolve -> winner gets paid into their wallet.
# For testing only.
#
#   ./sim-bettor.sh [durationSeconds]      # default 360s
#
# Each round it bets `betAmount` (read from the contract) from 3 wallets on buckets B, C, D
# (W1->B, W2->C, W3->D). After a round resolves, it claims for whichever of those buckets won.
# The OPERATOR runs separately (operator.sh); this script only calls placeBet/claim, never
# startRound/resolveRound, so it cannot collide with the operator.
#
# Wallet keys come from a file of W1_PK/W2_PK/W3_PK (+ *_ADDRESS) lines:
#   TEST_WALLETS_FILE=/path/to/wallets ./sim-bettor.sh
# Default path: ./.testwallets  (gitignored — keep burner keys here, never commit them).

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

# wallet i bets bucket BUCKETS[i]; index = bucket value so winner->wallet is direct
NAMES=(B C D); BUCKETS=(1 2 3); PKS=("$W1_PK" "$W2_PK" "$W3_PK"); ADDRS=("$W1_ADDRESS" "$W2_ADDRESS" "$W3_ADDRESS")
VALUE=$(cast call "$ADDR" 'betAmount()(uint256)' --rpc-url "$RPC" | sed 's/ .*//')
echo "sim-bettor: $ADDR | stake $(cast --to-unit "$VALUE" ether) MON/bet | running ${DURATION}s | bets B,C,D + claims winners"

round_field() { cast call "$ADDR" 'rounds(uint256)(uint64,uint64,bool,uint8,uint256,uint256,uint256)' "$1" --rpc-url "$RPC" 2>/dev/null | sed -n "${2}p"; }

# Keep a wallet funded for long runs: if it drops below 2 MON, top it back up to 6 MON from the
# deployer. Needs DEPLOYER_PRIVATE_KEY in ../.env; skipped (with a warning once) if absent.
TOPUP_WARNED=0
topup() {
  local A="$1"
  if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ]; then
    [ "$TOPUP_WARNED" = "0" ] && { echo "   (no DEPLOYER_PRIVATE_KEY — wallets will not auto-refill)"; TOPUP_WARNED=1; }
    return
  fi
  local bal; bal=$(cast balance --rpc-url "$RPC" "$A" 2>/dev/null || echo 0)
  if [ "$(python3 -c "print(1 if $bal < 2*10**18 else 0)")" = "1" ]; then
    local need; need=$(python3 -c "print(6*10**18 - $bal)")
    cast send "$A" --value "$need" --rpc-url "$RPC" --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null 2>&1 \
      && echo "   ↑ refilled $A to ~6 MON"
  fi
}

last_bet=0
pending=""   # rounds we bet on, awaiting resolve+claim
endts=$(( $(date +%s) + DURATION ))
while [ "$(date +%s)" -lt "$endts" ]; do
  rid=$(cast call "$ADDR" 'currentRoundId()(uint256)' --rpc-url "$RPC" 2>/dev/null || echo 0)

  # 1) claim any pending rounds that have resolved
  still=""
  for r in $pending; do
    if [ "$(round_field "$r" 3)" = "true" ]; then
      w=$(round_field "$r" 4 | sed 's/ .*//')          # winning bucket (uint8)
      pay=$(round_field "$r" 7 | sed 's/ .*//')
      if [ "$w" = "1" ] || [ "$w" = "2" ] || [ "$w" = "3" ]; then
        idx=$((w-1))
        if cast send "$ADDR" "claim(uint256)" "$r" --rpc-url "$RPC" --private-key "${PKS[$idx]}" >/dev/null 2>&1; then
          echo "   round $r: wallet $((idx+1)) (${NAMES[$idx]}) WON → claimed $(cast --to-unit "$pay" ether) MON"
        fi
      else
        echo "   round $r: no winner among B/C/D (house keeps stakes)"
      fi
    else
      still="$still $r"
    fi
  done
  pending="$still"

  # 2) bet on a freshly opened round
  if [ -n "$rid" ] && [ "$rid" != "0" ] && [ "$rid" != "$last_bet" ]; then
    resolved=$(round_field "$rid" 3); lock=$(round_field "$rid" 2 | sed 's/ .*//'); now=$(date +%s)
    if [ "$resolved" = "false" ] && [ -n "$lock" ] && [ "$now" -lt "$((lock-3))" ]; then
      echo "round $rid open — placing 3 bets (B,C,D)…"
      for i in 0 1 2; do topup "${ADDRS[$i]}"; done
      ok=0
      for i in 0 1 2; do
        cast send "$ADDR" "placeBet(uint8)" "${BUCKETS[$i]}" --value "$VALUE" --rpc-url "$RPC" --private-key "${PKS[$i]}" >/dev/null 2>&1 && ok=$((ok+1))
      done
      echo "   placed $ok/3 bets"
      [ "$ok" -gt 0 ] && pending="$pending $rid"
      last_bet="$rid"
    fi
  fi
  sleep 2
done
echo "sim-bettor: done"
