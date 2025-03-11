const ethers = require("ethers");
const colors = require("colors");
const readline = require("readline");
const axios = require("axios");
const fs = require("fs");
const config = require('./config');
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const contractAddress = "0xb2f82D0f38dc453D596Ad40A37799446Cc89274A";
const gasLimitStake = 500000;
const gasLimitUnstake = 800000;
const gasLimitClaim = 800000;

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
    const minPercentage = config.transactionLimits.minPercentage;
    const maxPercentage = config.transactionLimits.maxPercentage;
    
    const min = balance.mul(minPercentage * 10).div(1000); // minPercentage% of balance
    const max = balance.mul(maxPercentage * 10).div(1000); // maxPercentage% of balance
    
    if (min.lt(ethers.utils.parseEther(config.minimumTransactionAmount))) {
      console.log("Số dư quá thấp, sử dụng số lượng tối thiểu".yellow);
      return ethers.utils.parseEther(config.minimumTransactionAmount);
    }
    
    const range = max.sub(min);
    const randomBigNumber = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).mod(range);
    
    const randomAmount = min.add(randomBigNumber);
    
    return randomAmount;
  } catch (error) {
    console.error("❌ Error calculating random amount:".red, error.message);
    return ethers.utils.parseEther(config.defaultTransactionAmount);
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

async function requestUnstakeAprMON(wallet, amountToUnstake, cycleNumber) {
  try {
    console.log(
      `\n[Chu kỳ ${cycleNumber}] chuẩn bị unstake aprMON...`.magenta
    );
    console.log(`Wallet: ${wallet.address}`.cyan);
    console.log(
      `Số lượng unstake: ${ethers.utils.formatEther(
        amountToUnstake
      )} aprMON`
    );

    const data =
      "0x7d41c86e" +
      ethers.utils.hexZeroPad(amountToUnstake.toHexString(), 32).slice(2) +
      ethers.utils.hexZeroPad(wallet.address, 32).slice(2) +
      ethers.utils.hexZeroPad(wallet.address, 32).slice(2);

    const tx = {
      to: contractAddress,
      data: data,
      gasLimit: ethers.utils.hexlify(gasLimitUnstake),
      value: ethers.utils.parseEther("0"),
    };

    console.log("🔄 Gửi yêu cầu unstake...");
    const txResponse = await wallet.sendTransaction(tx);
    console.log(
      `➡️  Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("🔄 Đang chờ xác nhận giao dịch...");
    const receipt = await txResponse.wait();
    console.log(`✔️  Unstake thành công!`.green.underline);

    return receipt;
  } catch (error) {
    console.error("❌ Unstake thất bại:".red, error.message);
    throw error;
  }
}

async function checkClaimableStatus(walletAddress) {
  try {
    const apiUrl = `https://stake-api.apr.io/withdrawal_requests?address=${walletAddress}`;
    const response = await axios.get(apiUrl);

    const claimableRequest = response.data.find(
      (request) => !request.claimed && request.is_claimable
    );

    if (claimableRequest) {
      console.log(`Found claimable request ID: ${claimableRequest.id}`);
      return {
        id: claimableRequest.id,
        isClaimable: true,
      };
    }
    return {
      id: null,
      isClaimable: false,
    };
  } catch (error) {
    console.error(
      "❌ Lỗi rồi:".red,
      error.message
    );
    return {
      id: null,
      isClaimable: false,
    };
  }
}

async function claimMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Chu kỳ ${cycleNumber}] kiểm tra số Mon nhận lại...`);
    console.log(`Wallet: ${wallet.address}`.cyan);

    const { id, isClaimable } = await checkClaimableStatus(wallet.address);

    if (!isClaimable || !id) {
      console.log("Không tìm thấy yêu cầu rút tiền nào vào thời điểm này");
      return null;
    }

    console.log(`Yêu cầu rút tiền với ID: ${id}`);

    const data =
      "0x492e47d2" +
      "0000000000000000000000000000000000000000000000000000000000000040" +
      ethers.utils.hexZeroPad(wallet.address, 32).slice(2) +
      "0000000000000000000000000000000000000000000000000000000000000001" +
      ethers.utils
        .hexZeroPad(ethers.BigNumber.from(id).toHexString(), 32)
        .slice(2);

    const tx = {
      to: contractAddress,
      data: data,
      gasLimit: ethers.utils.hexlify(gasLimitClaim),
      value: ethers.utils.parseEther("0"),
    };

    console.log("Tạo giao dịch...");
    const txResponse = await wallet.sendTransaction(tx);
    console.log(`Transaction sent: ${EXPLORER_URL}${txResponse.hash}`);

    console.log("Đang chờ xác nhận giao dịch...");
    const receipt = await txResponse.wait();
    console.log(`Claim thành công với ID: ${id}`.green.underline);

    return receipt;
  } catch (error) {
    console.error("Claim thất bại:", error.message);
    throw error;
  }
}

async function runCycle(wallet, cycleNumber) {
  try {
    console.log(`\n=== Bắt đầu chu kỳ ${cycleNumber} / ${wallet.address} ===`);

    const { stakeAmount } = await stakeMON(wallet, cycleNumber);

    const delayTimeBeforeUnstake = getRandomDelay();
    console.log(
      `🔄 Đang chờ ${
        delayTimeBeforeUnstake / 1000
      } giây trước khi yêu cầu unstake...`
    );
    await delay(delayTimeBeforeUnstake);

    await requestUnstakeAprMON(wallet, stakeAmount, cycleNumber);

    console.log(
      `Chờ 660 giây (11 phút) trước khi kiểm tra trạng thái claim...`
        .magenta
    );
    await delay(660000);

    await claimMON(wallet, cycleNumber);

    console.log(
      `=== Chu kì ${cycleNumber} cho ví ${wallet.address} đã hoàn thành! ===`.magenta.bold
    );
  } catch (error) {
    console.error(`❌ Chu kì ${cycleNumber} thất bại:`.red, error.message);
    throw error;
  }
}

async function processAccount(privateKey, cycleCount) {
  try {
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    const shortAddress = `${wallet.address.substring(0, 6)}...${wallet.address.substring(wallet.address.length - 4)}`;
    console.log(`\n=== Đang xử lý tài khoản ${shortAddress} ===`.cyan.bold);

    const initialBalance = await provider.getBalance(wallet.address);
    console.log(`Balance: ${ethers.utils.formatEther(initialBalance)} MON`.yellow);

    for (let i = 1; i <= cycleCount; i++) {
      await runCycle(wallet, i);

      if (i < cycleCount) {
        const interCycleDelay = getRandomDelay();
        console.log(
          `\nChờ ${interCycleDelay / 1000} giây trước chu kỳ tiếp theo...`
        );
        await delay(interCycleDelay);
      }
    }

    const finalBalance = await provider.getBalance(wallet.address);
    console.log(`\nSố dư cuối cùng: ${ethers.utils.formatEther(finalBalance)} MON`.yellow);
    
    const difference = finalBalance.sub(initialBalance);
    if (difference.gt(0)) {
      console.log(`Profit: +${ethers.utils.formatEther(difference)} MON`.green);
    } else {
      console.log(`Loss: ${ethers.utils.formatEther(difference)} MON`.red);
    }

    console.log(`=== Đã hoàn tất quá trình xử lý ví ${shortAddress} ===`.cyan.bold);
    return true;
  } catch (error) {
    console.error(`❌ Xử lý tài khoản không thành công:`.red, error.message);
    return false;
  }
}

async function processAllAccounts(cycleCount, intervalHours) {
  try {
    const privateKeys = readPrivateKeys();
    if (privateKeys.length === 0) {
      console.error("Không tìm thấy privatekey trong wallet.txt".red);
      return false;
    }

    console.log(`📋 Tìm thấy ${privateKeys.length} ví trong wallet.txt`.cyan);
    console.log(`Chạy ${cycleCount} chu kỳ cho mỗi tài khoản...`.yellow);

    for (let i = 0; i < privateKeys.length; i++) {
      console.log(`\n🔄 Đang xử lý tài khoản ${i + 1} / ${privateKeys.length}`.cyan);
      const success = await processAccount(privateKeys[i], cycleCount);
      
      if (!success) {
        console.log(`⚠️ Không xử lý được tài khoản ${i + 1}, chuyển sang tài khoản tiếp theo`.yellow);
      }
      
      if (i < privateKeys.length - 1) {
        console.log("\nChuyển sang tài khoản tiếp theo sau 3 giây...".cyan);
        await delay(3000);
      }
    }

    console.log(
      `\n✅ Tất cả ${privateKeys.length} tài khoản đã được xử lý thành công!`.green.bold
    );
    
    if (intervalHours) {
      console.log(`\n⏱️ Tất cả các tài khoản được xử lý. Đợt tiếp theo sẽ chạy sau ${intervalHours} giờ`.cyan);
      setTimeout(() => processAllAccounts(cycleCount, intervalHours), intervalHours * 60 * 60 * 1000);
    }
    
    return true;
  } catch (error) {
    console.error("❌ Thao tác không thành công:".red, error.message);
    return false;
  }
}

function run() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("Bạn muốn chạy bao nhiêu chu kỳ cho mỗi tài khoản? ", (answer) => {
    const cycleCount = parseInt(answer);
    
    if (isNaN(cycleCount) || cycleCount <= 0) {
      console.error("Vui lòng nhập số hợp lệ!".red);
      rl.close();
      process.exit(1);
    }
    
    rl.question(
      "Bạn muốn chu kỳ chạy bao lâu một lần (tính bằng giờ)? (Nhấn enter để chạy ngay): ",
      (hours) => {
        let intervalHours = hours ? parseInt(hours) : null;
        
        if (hours && (isNaN(intervalHours) || intervalHours < 0)) {
          console.error("Vui lòng nhập số hợp lệ!".red);
          rl.close();
          process.exit(1);
        }
        processAllAccounts(cycleCount, intervalHours);
        rl.close();
      }
    );
  });
}

async function runAutomated(cycles = 1, intervalHours = null) {
  await processAllAccounts(cycles, intervalHours);
  return true;
}

module.exports = { 
  run, 
  runAutomated,
  stakeMON,
  requestUnstakeAprMON,
  claimMON,
  getRandomAmount,
  getRandomDelay,
};

if (require.main === module) {
  run();
}