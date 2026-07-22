.PHONY: install test build deploy-sepolia deploy-base fmt

install:
	forge install

test:
	forge test -vv

build:
	forge build

fmt:
	forge fmt

# Requires contracts/.env with PRIVATE_KEY, TREASURY, RPC, BASESCAN_API_KEY
deploy-sepolia:
	set -a && . ./.env && set +a && forge script script/DeployAbinc.s.sol:DeployAbinc \
		--rpc-url "$$BASE_SEPOLIA_RPC_URL" --broadcast --verify -vvvv

deploy-base:
	set -a && . ./.env && set +a && forge script script/DeployAbinc.s.sol:DeployAbinc \
		--rpc-url "$$BASE_RPC_URL" --broadcast --verify -vvvv
