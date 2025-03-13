const ethers = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const contractAddress = "0x3a98250F98Dd388C211206983453837C8365BDc1";
const gasLimitDeposit = 80000;
const gasLimitRedeem = 80000;
const gasLimitBond = 80000;

const contractABI = [
  {
    "type": "function",
    "name": "deposit",
    "inputs": [
      {
        "name": "assets",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "redeem",
    "inputs": [
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bond",
    "inputs": [
      {
        "name": "policyID",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "bondRecipient",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
];

function readPrivateKeys() {
  const data = fs.readFileSync("wallet.txt", "utf8");
  return data.split("\n").map((key) => key.trim()).filter((key) => key);
}

function createWallets(privateKeys) {
  return privateKeys.map((key) => new ethers.Wallet(key, provider));
}

async function getRandomAmount(wallet) {
  const balance = await provider.getBalance(wallet.address);
  const min = balance.mul(config.transactionLimits.minPercentage * 10).div(1000);
  const max = balance.mul(config.transactionLimits.maxPercentage * 10).div(1000);
  if (min.lt(ethers.utils.parseEther(config.minimumTransactionAmount))) {
    return ethers.utils.parseEther(config.minimumTransactionAmount);
  }
  const randomBigNumber = ethers.BigNumber.from(ethers.utils.randomBytes(32)).mod(max.sub(min));
  return min.add(randomBigNumber);
}

function getRandomDelay() {
  const minDelay = 3 * 1000;
  const maxDelay = 1 * 6 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function depositMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Chu kỳ ${cycleNumber}] bắt đầu deposit MON...`.magenta);
    console.log(`Wallet: ${wallet.address}`.cyan);

    const depositAmount = await getRandomAmount(wallet);
    console.log(
      `Random số lượng deposit: ${ethers.utils.formatEther(depositAmount)} MON (${config.transactionLimits.minPercentage}-${config.transactionLimits.maxPercentage}% balance)`
    );

    const contract = new ethers.Contract(contractAddress, contractABI, wallet);
    
    console.log("🔄 Gửi yêu cầu deposit...");
    const txResponse = await contract.deposit(
      depositAmount,
      wallet.address,
      {
        value: depositAmount,
        gasLimit: ethers.utils.hexlify(gasLimitDeposit)
      }
    );
    
    console.log(
      `➡️ Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("Đang chờ xác nhận giao dịch...");
    const receipt = await txResponse.wait();
    console.log(`✔️ Deposit thành công!`.green.underline);

    return { receipt, depositAmount };
  } catch (error) {
    console.error("❌ Deposit thất bại:".red, error.message);
    throw error;
  }
}

async function getShmonBalance(wallet) {
  try {
    const contract = new ethers.Contract(contractAddress, contractABI, provider);
    const balance = await contract.balanceOf(wallet.address);
    return balance;
  } catch (error) {
    console.error("❌ Lỗi khi kiểm tra số dư shMON:".red, error.message);
    throw error;
  }
}

async function redeemShMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Chu kỳ ${cycleNumber}] chuẩn bị redeem shMON...`.magenta);
    console.log(`Wallet: ${wallet.address}`.cyan);
    
    const shmonBalance = await getShmonBalance(wallet);
    console.log(`Số dư shMON hiện tại: ${ethers.utils.formatEther(shmonBalance)} shMON`);
    
    const redeemAmount = shmonBalance.mul(98).div(100);
    console.log(`Số lượng redeem (98%): ${ethers.utils.formatEther(redeemAmount)} shMON`);
    
    if (redeemAmount.lte(0)) {
      console.log("Không có shMON để redeem".yellow);
      return null;
    }
    
    const contract = new ethers.Contract(contractAddress, contractABI, wallet);
    
    console.log("🔄 Gửi yêu cầu redeem...");
    const txResponse = await contract.redeem(
      redeemAmount,
      wallet.address,
      wallet.address,
      {
        gasLimit: ethers.utils.hexlify(gasLimitRedeem)
      }
    );
    
    console.log(
      `➡️ Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("🔄 Đang chờ xác nhận giao dịch...");
    const receipt = await txResponse.wait();
    console.log(`✔️ Redeem thành công!`.green.underline);

    return receipt;
  } catch (error) {
    console.error("❌ Redeem thất bại:".red, error.message);
    throw error;
  }
}


async function bondShMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Chu kỳ ${cycleNumber}] chuẩn bị commit shMON...`.magenta);
    console.log(`Wallet: ${wallet.address}`.cyan);
    
    const shmonBalance = await getShmonBalance(wallet);
    console.log(`Số dư shMON còn lại: ${ethers.utils.formatEther(shmonBalance)} shMON`);
    
    const bondAmount = shmonBalance.mul(50).div(100);
    console.log(`Số lượng commit (50%): ${ethers.utils.formatEther(bondAmount)} shMON`);
    
    if (bondAmount.lte(0)) {
      console.log("Không có shMON để commit".yellow);
      return null;
    }
    
    const contract = new ethers.Contract(contractAddress, contractABI, wallet);
    const policyID = 4; // PolicyID mặc định là 4
    
    console.log("🔄 Gửi yêu cầu commit...");
    const txResponse = await contract.bond(
      policyID,
      wallet.address,
      bondAmount,
      {
        gasLimit: ethers.utils.hexlify(gasLimitBond)
      }
    );
    
    console.log(
      `➡️ Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("🔄 Đang chờ xác nhận giao dịch...");
    const receipt = await txResponse.wait();
    console.log(`✔️ Commit thành công!`.green.underline);

    return receipt;
  } catch (error) {
    console.error("❌ Commit thất bại:".red, error.message);
    throw error;
  }
}

async function processTask(wallets, taskFunc, taskName, gasLimit) {
  for (const wallet of wallets) {
    try {
      const contract = new ethers.Contract(contractAddress, contractABI, wallet);
      const amount = await getRandomAmount(wallet);
      console.log(`Thực hiện ${taskName} cho ví: ${wallet.address}`);

      let tx;
      if (taskName === "deposit") {
        tx = await contract.deposit(amount, wallet.address, {
          value: amount,
          gasLimit: ethers.utils.hexlify(gasLimit),
        });
      } else if (taskName === "redeem") {
        const balance = await contract.balanceOf(wallet.address);
        tx = await contract.redeem(balance.mul(98).div(100), wallet.address, wallet.address, {
          gasLimit: ethers.utils.hexlify(gasLimit),
        });
      } else if (taskName === "bond") {
        const balance = await contract.balanceOf(wallet.address);
        tx = await contract.bond(4, wallet.address, balance.mul(50).div(100), {
          gasLimit: ethers.utils.hexlify(gasLimit),
        });
      }

      console.log(`Transaction hash: ${tx.hash}`);
      await delay(500);
    } catch (error) {
      console.error(`Lỗi khi thực hiện ${taskName} cho ví ${wallet.address}:`, error.message);
    }
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

    for (let i = 0; i < 2; i++) {
      console.log(`\n🔄 Đang xử lý tài khoản ${i + 1} / ${privateKeys.length}`.cyan);
      const success = await processAccount(privateKeys[i], cycleCount);
      
      if (!success) {
        console.log(`⚠️ Không xử lý được tài khoản ${i + 1}, chuyển sang tài khoản tiếp theo`.yellow);
      }
      
      if (i < privateKeys.length - 1) {
        console.log("\nChuyển sang tài khoản tiếp theo sau 0.5 giây...".cyan);
        await delay(500);
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

async function run() {
  const privateKeys = readPrivateKeys();
  const wallets = createWallets(privateKeys);

  for (let i = 0; i < 2; i++) {
    console.log("🔄 Bắt đầu chu kỳ mới...");

    await processTask(wallets, "deposit", "deposit", gasLimitDeposit);
    await processTask(wallets, "redeem", "redeem", gasLimitRedeem);
    await processTask(wallets, "bond", "bond", gasLimitBond);

    console.log("✅ Hoàn thành chu kỳ, bắt đầu chu kỳ tiếp theo...");
  }
  console.log("🎉 Đã hoàn tất tất cả các chu kỳ!");
  process.exit(0);
}

async function runAutomated(cycles = 1, intervalHours = null) {
  await processAllAccounts(cycles, intervalHours);
  return true;
}

module.exports = { 
  run, 
  runAutomated,
  depositMON,
  redeemShMON,
  bondShMON,
  getRandomAmount,
  getRandomDelay,
};

if (require.main === module) {
  run();
}