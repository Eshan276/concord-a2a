#!/usr/bin/env bash
# Deploy ConcordLedger to HSK Chain.  Usage: OPERATOR_PRIVATE_KEY=0x… ./deploy.sh [mainnet|testnet]
set -euo pipefail
cd "$(dirname "$0")"
NET=${1:-mainnet}
if [ "$NET" = mainnet ]; then RPC=https://mainnet.hsk.xyz; else RPC=https://testnet.hsk.xyz; fi
export PATH="$HOME/.foundry/bin:$PATH"
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" --private-key "$OPERATOR_PRIVATE_KEY" --broadcast --legacy
