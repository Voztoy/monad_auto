const ethers = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');

const CHAIN_CONFIG = {
  RPC_URL: "https://testnet-rpc.monad.xyz",
  CHAIN_ID: 10143,
  SYMBOL: "MON",
  TX_EXPLORER: "https://testnet.monadexplorer.com/tx/",
  ADDRESS_EXPLORER: "https://testnet.monadexplorer.com/address/",
  WMON_ADDRESS: "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701"
};

const KINTSU_CONTRACT = {
  SMON_STAKE_CONTRACT: "0x07AabD925866E8353407E67C1D157836f7Ad923e",
  KINTSU_ABI: [
    {
      name: "stake",
      type: "function",
      stateMutability: "payable",
      inputs: [],  
      outputs: []
    },
    {
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [
        {
          name: "account",
          type: "address"
        }
      ],
      outputs: [
        {
          type: "uint256"
        }
      ]
    },
    {
      name: "symbol",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          type: "string"
        }
      ]
    },
    {
      name: "name",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          type: "string"
        }
      ]
    },
    {
      name: "decreaseStake",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "tokenId",
          type: "uint256"
        },
        {
          name: "stakeAmount",
          type: "uint256"
        }
      ],
      outputs: []
    },
    {
      name: "increaseStake",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "tokenId",
          type: "uint256"
        },
        {
          name: "stakeAmount",
          type: "uint256"
        }
      ],
      outputs: []
    },
    {
      name: "totalStaked",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          type: "uint256"
        }
      ]
    }
  ]
};

const provider = new ethers.providers.JsonRpcProvider(CHAIN_CONFIG.RPC_URL);
const contractAddress = KINTSU_CONTRACT.SMON_STAKE_CONTRACT;
const gasLimitStake = 250000;
const gasLimitUnstake = 400000;

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
    const address = await wallet.getAddress();
    
    const minAmount = ethers.utils.parseEther("0.05");
    const maxAmount = ethers.utils.parseEther("0.1");
    
    const range = maxAmount.sub(minAmount);
    const randomBigNumber = ethers.BigNumber.from(
      ethers.utils.randomBytes(4)
    ).mod(range.add(1));
    
    const randomAmount = minAmount.add(randomBigNumber);
    
    console.log(`Số lượng mon sử dụng: ${ethers.utils.formatEther(randomAmount)} ${CHAIN_CONFIG.SYMBOL}`);
    
    return randomAmount;
  } catch (error) {
    console.error("Lỗi tính toán số mon cần dùng:".red, error.message);
    console.log(`Sử dụng số lượng mặc định 0.01 ${CHAIN_CONFIG.SYMBOL}`.yellow);
    return ethers.utils.parseEther("0.01");
  }
}

function getRandomDelay() {
  const minDelay = 30 * 1000;
  const maxDelay = 2 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

function getRandomGasLimit() {
  return Math.floor(Math.random() * (250000 - 150000 + 1)) + 150000;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stakeMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Chu kỳ ${cycleNumber}] Bắt đầu stake MON...`.magenta);
    
    const walletAddress = await wallet.getAddress();
    console.log(`Wallet: ${walletAddress}`.cyan);
    
    const contract = new ethers.Contract(contractAddress, KINTSU_CONTRACT.KINTSU_ABI, provider);
    const stakeAmount = await getRandomAmount(wallet);
    
    console.log(
      `Số lượng Stake: ${ethers.utils.formatEther(stakeAmount)} ${CHAIN_CONFIG.SYMBOL}`
    );

    const gasLimit = getRandomGasLimit();
    const feeData = await provider.getFeeData();
    const baseFee = feeData.maxFeePerGas || feeData.gasPrice;
    const maxFeePerGas = baseFee.mul(105).div(100);
    const maxPriorityFeePerGas = maxFeePerGas;

    console.log("🔄 Tạo giao dịch...");
    const txResponse = await contract.connect(wallet).stake({
      value: stakeAmount,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    });
    
    console.log(
      `➡️  Transaction sent: ${CHAIN_CONFIG.TX_EXPLORER}${txResponse.hash}`.yellow
    );

    console.log("🔄 Đang chờ xác nhận...");
    const receipt = await txResponse.wait();
    console.log(`✔️  Stake thành công!`.green.underline);

    const sMonBalance = await contract.balanceOf(walletAddress);
    console.log(
      `⭐ SMON balance: ${parseFloat(ethers.utils.formatEther(sMonBalance)).toFixed(6)}`.magenta
    );

    return { receipt, stakeAmount };
  } catch (error) {
    console.error("❌ Stake thất bại:".red, error.message);
    throw error;
  }
}

async function unStake(wallet, tokenId, stakeAmount, cycleNumber) {
  try {
    console.log(
      `\n[Chu kỳ ${cycleNumber}] Bắt đầu kiểm tra để unstake...`.magenta
    );
    
    const walletAddress = await wallet.getAddress();
    console.log(`Wallet: ${walletAddress}`.cyan);
    
    const contract = new ethers.Contract(contractAddress, KINTSU_CONTRACT.KINTSU_ABI, provider);
    
    const sMonBalance = await contract.balanceOf(walletAddress);
    const sMonBalanceEth = parseFloat(ethers.utils.formatEther(sMonBalance));
    console.log(`⭐ SMON balance: ${sMonBalanceEth.toFixed(6)}`.magenta);
    
    if (sMonBalanceEth <= 0.01) {
      console.log(`Số dư SMON nhỏ hơn 0,1. không unstake.`.yellow);
      return null;
    }
    
    console.log(
      `Số lượng unstake: 0,1 ${CHAIN_CONFIG.SYMBOL}`
    );

    const gasLimit = getRandomGasLimit();
    const feeData = await provider.getFeeData();
    const baseFee = feeData.maxFeePerGas || feeData.gasPrice;
    const maxFeePerGas = baseFee.mul(105).div(100);
    const maxPriorityFeePerGas = maxFeePerGas;

    console.log("🔄 Tạo giao dịch unstake...");
    
    const unstakeData = "0x30af6b2e000000000000000000000000000000000000000000000000016345785d8a0000";
    const encodedTokenId = ethers.utils.hexZeroPad(ethers.utils.hexlify(tokenId), 32).slice(2);
    const modifiedData = unstakeData.slice(0, 10) + encodedTokenId + unstakeData.slice(74);
    
    const tx = {
      to: contractAddress,
      data: unstakeData,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    };

    const txResponse = await wallet.sendTransaction(tx);
    
    console.log(
      `➡️ Transaction sent ${CHAIN_CONFIG.TX_EXPLORER}${txResponse.hash}`.yellow
    );

    console.log("🔄 Đang chờ xác nhận...");
    const receipt = await txResponse.wait();
    console.log(`✔️ Unstake thành công!`.green.underline);

    const updatedSMonBalance = await contract.balanceOf(walletAddress);
    console.log(
      `⭐ Updated SMON balance: ${parseFloat(ethers.utils.formatEther(updatedSMonBalance)).toFixed(6)}`.magenta
    );

    return receipt;
  } catch (error) {
    console.error("❌ Unstake thất bại:".red, error.message);
    console.error("Lỗi:", JSON.stringify(error, null, 2));
    throw error;
  }
}

async function runCycle(wallet, cycleNumber, tokenId) {
  try {
    const walletAddress = await wallet.getAddress();
    console.log(`\n=== Bắt đầu chu kỳ ${cycleNumber} cho ví ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} ===`.magenta.bold);

    const { stakeAmount } = await stakeMON(wallet, cycleNumber);

    const delayTime = getRandomDelay();
    console.log(`Cần chờ ${delayTime / 1000} giây trước khi kiểm tra unstake...`);
    await delay(delayTime);

    const unstakeResult = await unStake(wallet, tokenId || 1, stakeAmount, cycleNumber);
    
    if (unstakeResult === null) {
      console.log(`Đã bỏ qua unstake do sMON balance thấp hơn 0.1`.yellow);
    }

    console.log(
      `=== Chu kỳ ${cycleNumber} của ví ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} đã hoàn thành! ===`.magenta.bold
    );
    return true;
  } catch (error) {
    console.error(`❌ Chu kỳ ${cycleNumber} gặp lỗi:`.red, error.message);
    return false;
  }
}

async function processWallet(privateKey, cycleCount, walletIndex, totalWallets, tokenId) {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const walletAddress = await wallet.getAddress();
    
    console.log(`\n=== Đang xử lý ví ${walletIndex + 1}/${totalWallets}: ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} ===`.cyan.bold);
    
    for (let i = 1; i <= cycleCount; i++) {
      const success = await runCycle(wallet, i, tokenId);
      
      if (!success) {
        console.log(`Bỏ qua các chu kỳ còn lại của ví này do lỗi`.yellow);
        break;
      }
      
      if (i < cycleCount) {
        const interCycleDelay = getRandomDelay();
        console.log(
          `\nCần chờ ${interCycleDelay / 1000} giây cho chu kỳ tiếp theo...`
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
    
    rl.question("Bạn muốn chạy bao nhiêu chu kỳ cho mỗi ví? ", (answer) => {
      const cycleCount = parseInt(answer);
      if (isNaN(cycleCount) || cycleCount <= 0) {
        console.error("Vui lòng nhập số hợp lệ!".red);
        rl.close();
        process.exit(1);
      }
      rl.close();
      resolve(cycleCount);
    });
  });
}

function getTokenId() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    rl.question("Nhập ID token để unstake (default: 1): ", (answer) => {
      const tokenId = parseInt(answer) || 1;
      rl.close();
      resolve(tokenId);
    });
  });
}

async function run() {
  try {
    console.log("Bắt đầu chạy Kintsu...".green);
    console.log("Đọc ví từ wallet.txt...".yellow);
    
    const privateKeys = readPrivateKeys();
    console.log(`Tìm thấy ${privateKeys.length} ví trong wallet.txt`.green);
    
    const cycleCount = await getCycleCount();
    const tokenId = await getTokenId();
    console.log(`Bắt đầu chu kỳ ${cycleCount} trên mỗi ví có ID token ${tokenId}...`.yellow);
    
    for (let i = 0; i < privateKeys.length; i++) {
      await processWallet(privateKeys[i], cycleCount, i, privateKeys.length, tokenId);
      
      if (i < privateKeys.length - 1) {
        console.log(`\nChuyển sang ví tiếp theo sau 3 giây...`.yellow);
        await delay(3000);
      }
    }
    
    console.log(
      `\nTất cả các ví được xử lý thành công!`.green.bold
    );
  } catch (error) {
    console.error("Thao tác không thành công:".red, error.message);
  }
}

async function runAutomated(cycles = 1, tokenId = 1, intervalHours = null) {
  try {
    console.log("[Automated] Bắt đầu chạy Kintsu...".green);
    console.log("Đọc ví từ wallet.txt...".yellow);
    
    const privateKeys = readPrivateKeys();
    console.log(`Tìm thấy ${privateKeys.length} ví trong wallet.txt`.green);
    console.log(`[Automated] Bắt đầu chu kỳ ${cycles} trên mỗi ví có ID token ${tokenId}...`.yellow);
    
    for (let i = 0; i < privateKeys.length; i++) {
      await processWallet(privateKeys[i], cycles, i, privateKeys.length, tokenId);
      
      if (i < privateKeys.length - 1) {
        console.log(`\nChuyển sang ví tiếp theo sau 3 giây...`.yellow);
        await delay(3000);
      }
    }
    
    console.log(`\n[Automated] Tất cả các ví được xử lý thành công!`.green.bold);
    
    if (intervalHours) {
      const intervalMs = intervalHours * 60 * 60 * 1000;
      console.log(`\n⏱️ Lần chạy tiếp theo được lên lịch sau ${intervalHours} giờ`.cyan);
      setTimeout(() => runAutomated(cycles, tokenId, intervalHours), intervalMs);
    }
    
    return true;
  } catch (error) {
    console.error("[Automated] Thao tác không thành công:".red, error.message);
    return false;
  }
}

let configCycles = 1;
let configTokenId = 1;

function setCycles(cycles) {
  if (cycles && !isNaN(cycles) && cycles > 0) {
    configCycles = cycles;
    console.log(`[Config] Set cycles to ${cycles}`.yellow);
  }
}

function setTokenId(tokenId) {
  if (tokenId && !isNaN(tokenId) && tokenId > 0) {
    configTokenId = tokenId;
    console.log(`[Config] Set token ID to ${tokenId}`.yellow);
  }
}

module.exports = {
  run,
  runAutomated,
  setCycles,
  setTokenId,
  stakeMON,
  unStake,
  getRandomAmount,
  getRandomDelay,
};

if (require.main === module) {
  run();
}