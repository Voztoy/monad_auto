const ethers = require("ethers");
const colors = require("colors");
const readline = require("readline");
const axios = require("axios");
const fs = require("fs");

const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const contractAddress = "0xb2f82D0f38dc453D596Ad40A37799446Cc89274A";
const gasLimitStake = 100000;
const gasLimitUnstake = 100000;
const gasLimitClaim = 100000;

const minimalABI = [
  "function getPendingUnstakeRequests(address) view returns (uint256[] memory)",
];

function readPrivateKeys() {
  try {
    const data = fs.readFileSync('wallet.txt', 'utf8');
    const privateKeys = data.split('\n')
      .map(key => key.trim())
      .filter(key => key.length > 0);

    console.log(`Tìm thấy ${privateKeys.length} ví trong wallet.txt`.green);
    return privateKeys;
  } catch (error) {
    console.error("❌ Không đọc được file wallet.txt:".red, error.message);
    process.exit(1);
  }
}

async function getRandomAmount(wallet) {
  try {
    const balance = await provider.getBalance(wallet.address);
    const min = balance.mul(1).div(100);
    const max = balance.mul(5).div(100);

    if (min.lt(ethers.utils.parseEther("0.0001"))) {
      console.log("Số dư quá thấp, sử dụng số lượng tối thiểu".yellow);
      return ethers.utils.parseEther("0.0001");
    }

    const range = max.sub(min);
    const randomBigNumber = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).mod(range);

    const randomAmount = min.add(randomBigNumber);

    return randomAmount;
  } catch (error) {
    console.error("❌ Error calculating random amount:".red, error.message);
    return ethers.utils.parseEther("0.01");
  }
}

function getRandomDelay() {
  const minDelay = 30 * 1000;
  const maxDelay = 1 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stakeMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Chu kỳ ${cycleNumber}] bắt đầu stake MON...`.magenta);
    console.log(`Wallet: ${wallet.address}`.cyan);

    const stakeAmount = await getRandomAmount(wallet);
    console.log(
      `Random số lượng stake: ${ethers.utils.formatEther(stakeAmount)} MON (1-5% balance)`
    );

    const data =
      "0x6e553f65" +
      ethers.utils.hexZeroPad(stakeAmount.toHexString(), 32).slice(2) +
      ethers.utils.hexZeroPad(wallet.address, 32).slice(2);

    const tx = {
      to: contractAddress,
      data: data,
      gasLimit: ethers.utils.hexlify(gasLimitStake),
      value: stakeAmount,
    };

    console.log("🔄 Gửi yêu cầu stake...");
    const txResponse = await wallet.sendTransaction(tx);
    console.log(
      `➡️  Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("Đang chờ xác nhận giao dịch...");
    const receipt = await txResponse.wait();
    console.log(`✔️ Stake thành công!`.green.underline);

    return { receipt, stakeAmount };
  } catch (error) {
    console.error("❌ Stake thất bại:".red, error.message);
    throw error;
  }
}
