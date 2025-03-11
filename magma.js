const ethers = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const contractAddress = "0x2c9C959516e9AAEdB2C748224a41249202ca8BE7";
const gasLimitStake = 500000;
const gasLimitUnstake = 800000;


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

async function getRandomAmount(wallet) {
  try {
    const balance = await wallet.getBalance();
    const minPercentage = config.transactionLimits.minPercentage;
    const maxPercentage = config.transactionLimits.maxPercentage;
    
    const minAmount = balance.mul(minPercentage * 10).div(1000); // minPercentage% of balance
    const maxAmount = balance.mul(maxPercentage * 10).div(1000); // maxPercentage% of balance
    
    if (minAmount.eq(0) || balance.lt(minAmount)) {
      console.error("Không đủ số dư stake".red);
      throw new Error("Số dư không đủ");
    }
    
    const range = maxAmount.sub(minAmount);
    const randomBigNumber = ethers.BigNumber.from(
      ethers.utils.randomBytes(4)
    ).mod(range.add(1));
    
    const randomAmount = minAmount.add(randomBigNumber);
    
    return randomAmount;
  } catch (error) {
    console.error("Error calculating random amount:".red, error.message);
    throw error;
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
    console.log(`\n[Chu kì ${cycleNumber}] Bắt đầu stake MON...`.magenta);
    
    const walletAddress = await wallet.getAddress();
    console.log(`Wallet: ${walletAddress}`.cyan);
    
    const stakeAmount = await getRandomAmount(wallet);
    console.log(
      `Random số lượng stake: ${ethers.utils.formatEther(stakeAmount)} MON (1-5% balance)`
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
    const receipt = await txResponse.wait();
    console.log(`✔️  Stake thành công!`.green.underline);

    return { receipt, stakeAmount };
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
    const receipt = await txResponse.wait();
    console.log(`✔️  Unstake thành công!`.green.underline);

    return receipt;
  } catch (error) {
    console.error("❌ Unstake thất bại:".red, error.message);
    console.error("Full error:", JSON.stringify(error, null, 2));
    throw error;
  }
}

async function runCycle(wallet, cycleNumber) {
  try {
    const walletAddress = await wallet.getAddress();
    console.log(`\n=== Bắt đầu chu kì ${cycleNumber} cho ví ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} ===`.magenta.bold);

    const { stakeAmount } = await stakeMON(wallet, cycleNumber);

    const delayTime = getRandomDelay();
    console.log(`Chờ ${delayTime / 1000} giây để bắt đầy unstake...`);
    await delay(delayTime);

    await unstakeGMON(wallet, stakeAmount, cycleNumber);

    console.log(
      `=== Chu kì ${cycleNumber} cho ví ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} đã hoàn thành! ===`.magenta.bold
    );
    return true;
  } catch (error) {
    console.error(`❌ Chu kì ${cycleNumber} gặp lỗi:`.red, error.message);
    return false;
  }
}

async function processWallet(privateKey, cycleCount, walletIndex, totalWallets) {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const walletAddress = await wallet.getAddress();
    
    console.log(`\n=== Đang xử lý ví ${walletIndex + 1}/${totalWallets}: ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} ===`.cyan.bold);
    
    for (let i = 1; i <= cycleCount; i++) {
      const success = await runCycle(wallet, i);
      
      if (!success) {
        console.log(`Bỏ qua các chu kỳ còn lại của ví này do lỗi`.yellow);
        break;
      }
      
      if (i < cycleCount) {
        const interCycleDelay = getRandomDelay();
        console.log(
          `\nChờ ${interCycleDelay / 1000} giây cho chu kỳ tiếp theo...`
        );
        await delay(interCycleDelay);
      }
    }
    
    console.log(`\n=== Đã hoàn thành tất cả các chu kỳ cho ví ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} ===`.cyan.bold);
    
  } catch (error) {
    console.error(`Lỗi xử lý ví ${walletIndex + 1}:`.red, error.message);
  }
}

function getCycleCount() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
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
    console.log("Đọc ví từ wallet.txt...".yellow);
    
    const privateKeys = readPrivateKeys();
    console.log(`Tìm thấy ${privateKeys.length} ví từ wallet.txt`.green);
    
    const cycleCount = await getCycleCount();
    console.log(`Bắt đầu chạy ${cycleCount} chu kỳ trên mỗi ví...`.yellow);
    
    for (let i = 0; i < privateKeys.length; i++) {
      await processWallet(privateKeys[i], cycleCount, i, privateKeys.length);
      
      if (i < privateKeys.length - 1) {
        console.log(`\nChuyển sang ví tiếp theo sau 3 giây...`.yellow);
        await delay(3000);
      }
    }
    
    console.log(
      `\nTất cả các ví đã được xử lý thành công!`.green.bold
    );
  } catch (error) {
    console.error("Thao tác không thành công:".red, error.message);
  }
}

async function runAutomated(cycles = 1, intervalHours = null) {
  try {
    console.log("[Automated] Bắt đầu Magma Stake...".green);
    console.log("Đọc ví từ wallet.txt...".yellow);
    
    const privateKeys = readPrivateKeys();
    console.log(`Tìm thấy ${privateKeys.length} ví từ wallet.txt`.green);
    console.log(`[Automated] Bắt đầu chạy ${cycles} chu kỳ trên mỗi ví...`.yellow);
    
    for (let i = 0; i < privateKeys.length; i++) {
      await processWallet(privateKeys[i], cycles, i, privateKeys.length);
      
      if (i < privateKeys.length - 1) {
        console.log(`\nChuyển sang ví tiếp theo sau 3 giây...`.yellow);
        await delay(3000);
      }
    }
    
    console.log(`\n[Automated] Tất cả các ví đã được xử lý thành công!`.green.bold);
    
    if (intervalHours) {
      const intervalMs = intervalHours * 60 * 60 * 1000;
      console.log(`\n⏱️ Lần chạy tiếp theo được lên lịch sau ${intervalHours} giờ(s)`.cyan);
      setTimeout(() => runAutomated(cycles, intervalHours), intervalMs);
    }
    
    return true;
  } catch (error) {
    console.error("[Automated] Thao tác không thành công:".red, error.message);
    return false;
  }
}

let configCycles = 1;
function setCycles(cycles) {
  if (cycles && !isNaN(cycles) && cycles > 0) {
    configCycles = cycles;
    console.log(`[Config] Đặt chu kỳ thành ${cycles}`.yellow);
  }
}

module.exports = {
  run,
  runAutomated,
  setCycles,
  stakeMON,
  unstakeGMON,
  getRandomAmount,
  getRandomDelay,
};

if (require.main === module) {
  run();
}