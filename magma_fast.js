const ethers = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const contractAddress = "0x2c9C959516e9AAEdB2C748224a41249202ca8BE7";
const gasLimitStake = 120000;
const gasLimitUnstake = 120000;

function readPrivateKeys() {
  try {
    const fileContent = fs.readFileSync("wallet.txt", "utf8");
    const privateKeys = fileContent
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (privateKeys.length === 0) {
      console.error("Không tìm thấy privatekey trong wallet.txt".red);
      process.exit(1);
    }

    return privateKeys;
  } catch (error) {
    console.error("Không đọc được file wallet.txt:".red, error.message);
    process.exit(1);
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stakeMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Chu kì ${cycleNumber}] Bắt đầu stake MON...`.magenta);

    const walletAddress = await wallet.getAddress();
    console.log(`Wallet: ${walletAddress}`.cyan);

    const balance = await wallet.getBalance();
    const stakeAmount = balance.mul(ethers.BigNumber.from(2)).div(100); // Stake 2% số dư

    if (stakeAmount.eq(0) || balance.lt(stakeAmount)) {
      console.error("Không đủ số dư stake".red);
      throw new Error("Số dư không đủ");
    }

    console.log(
      `Random số lượng stake: ${ethers.utils.formatEther(stakeAmount)} MON (2% balance)`
    );

    const tx = {
      to: contractAddress,
      data: "0xd5575982",
      gasLimit: ethers.utils.hexlify(gasLimitStake),
      value: stakeAmount,
    };

    console.log("🔄 Bắt đầu tạo giao dịch...");
    const txResponse = await wallet.sendTransaction(tx);
    console.log(
      `➡️  Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("🔄 Đang chờ xác nhận giao dịch...");
    await txResponse.wait();
    console.log(`✔️  Stake thành công!`.green.underline);

    return stakeAmount;
  } catch (error) {
    console.error("❌ Stake thất bại:".red, error.message);
    throw error;
  }
}

async function unstakeGMON(wallet, amountToUnstake, cycleNumber) {
  try {
    console.log(
      `\n[Chu kì ${cycleNumber}] bắt đầu unstake gMON...`.magenta
    );

    const walletAddress = await wallet.getAddress();
    console.log(`Wallet: ${walletAddress}`.cyan);

    console.log(
      `Số lượng unstake: ${ethers.utils.formatEther(amountToUnstake)} gMON`
    );

    const functionSelector = "0x6fed1ea7";
    const paddedAmount = ethers.utils.hexZeroPad(
      amountToUnstake.toHexString(),
      32
    );
    const data = functionSelector + paddedAmount.slice(2);

    const tx = {
      to: contractAddress,
      data: data,
      gasLimit: ethers.utils.hexlify(gasLimitUnstake),
    };

    console.log("🔄 Bắt đầu tạo giao dịch...");
    const txResponse = await wallet.sendTransaction(tx);
    console.log(
      `➡️  Transaction sent ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("🔄 Đang chờ xác nhận giao dịch...");
    await txResponse.wait();
    console.log(`✔️  Unstake thành công!`.green.underline);

  } catch (error) {
    console.error("❌ Unstake thất bại:".red, error.message);
    throw error;
  }
}

async function processWalletsInSequence(privateKeys, cycleCount) {
  try {
    for (let cycle = 1; cycle <= cycleCount; cycle++) {
      console.log(`\n=== Bắt đầu chu kỳ ${cycle} ===`.magenta.bold);

      // Stake cho tất cả các ví trước
      const stakeAmounts = [];
      for (let i = 0; i < privateKeys.length; i++) {
        const wallet = new ethers.Wallet(privateKeys[i], provider);
        console.log(`\n[Chu kỳ ${cycle}] Xử lý Stake cho ví ${i + 1}/${privateKeys.length}`.cyan);

        try {
          const amount = await stakeMON(wallet, cycle);
          stakeAmounts.push({ wallet, amount });
        } catch (error) {
          console.error(`Lỗi khi stake ở ví ${i + 1}:`.red, error.message);
        }

        await delay(500);
      }

      // Sau khi stake xong, quay lại unstake
      for (let i = 0; i < stakeAmounts.length; i++) {
        const { wallet, amount } = stakeAmounts[i];
        console.log(`\n[Chu kỳ ${cycle}] Xử lý Unstake cho ví ${i + 1}/${privateKeys.length}`.cyan);

        try {
          await unstakeGMON(wallet, amount, cycle);
        } catch (error) {
          console.error(`Lỗi khi unstake ở ví ${i + 1}:`.red, error.message);
        }

        await delay(500);
      }

      console.log(`\n=== Kết thúc chu kỳ ${cycle} ===`.magenta.bold);
    }

    console.log("\n✅ Hoàn thành tất cả các chu kỳ!".green.bold);
  } catch (error) {
    console.error("Lỗi trong quá trình xử lý ví: ".red, error.message);
  }
}

async function getCycleCount() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Bạn muốn chạy bao nhiêu chu kì stake cho mỗi ví? ", (answer) => {
      const cycleCount = parseInt(answer);
      if (isNaN(cycleCount) || cycleCount <= 0) {
        console.error("Vui lòng nhập số!".red);
        rl.close();
        process.exit(1);
      }
      rl.close();
      resolve(cycleCount);
    });
  });
}

async function run() {
  try {
    console.log("Bắt đầu Magma Stake...".green);
    const privateKeys = readPrivateKeys();
    const cycleCount = await getCycleCount();
    await processWalletsInSequence(privateKeys, cycleCount);
  } catch (error) {
    console.error("Thao tác không thành công: ".red, error.message);
  }
}

if (require.main === module) {
  run();
}
