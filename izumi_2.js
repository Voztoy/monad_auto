const { ethers } = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");

const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const WMON_CONTRACT = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

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
    
    console.log(`Tìm thấy ${privateKeys.length} ví trong wallet.txt`.green);
    return privateKeys;
  } catch (error) {
    console.error("Không đọc được file wallet.txt:".red, error.message);
    process.exit(1);
  }
}

async function getRandomAmount(wallet) {
  try {
    const balance = await wallet.getBalance();
    const minAmount = balance.mul(1).div(100);
    const maxAmount = balance.mul(5).div(100);
    
    if (minAmount.eq(0) || balance.lt(minAmount)) {
      console.error("Số dư không đủ để swap".red);
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
  const minDelay = 30 * 300;
  const maxDelay = 1 * 60 * 300;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function wrapMON(wallet, amount, cycleNumber) {
  try {
    const address = await wallet.getAddress();
    const formattedAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    
    console.log(
      `[Ví ${formattedAddress}][Chu kì ${cycleNumber}] 🔄 Wrap ${ethers.utils.formatEther(amount)} MON → WMON...`.magenta
    );
    
    const contract = new ethers.Contract(
      WMON_CONTRACT,
      [
        "function deposit() public payable",
        "function withdraw(uint256 amount) public",
      ],
      wallet
    );
    
    const tx = await contract.deposit({ value: amount, gasLimit: 150000 });
    console.log(`✔️  Wrap MON → WMON thành công`.green.underline);
    console.log(`➡️  Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Lỗi wrap MON:".red, error.message);
    return false;
  }
}

async function unwrapMON(wallet, amount, cycleNumber) {
  try {
    const address = await wallet.getAddress();
    const formattedAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    
    console.log(
      `[Ví ${formattedAddress}][Chu kì ${cycleNumber}] 🔄 Unwrap ${ethers.utils.formatEther(amount)} WMON → MON...`.magenta
    );
    
    const contract = new ethers.Contract(
      WMON_CONTRACT,
      [
        "function deposit() public payable",
        "function withdraw(uint256 amount) public",
      ],
      wallet
    );
    
    const tx = await contract.withdraw(amount, { gasLimit: 150000 });
    console.log(`✔️  Unwrap WMON → MON thành công`.green.underline);
    console.log(`➡️  Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Lỗi unwrap WMON:".red, error.message);
    return false;
  }
}

async function processWallet(privateKey, cycles, walletIndex, totalWallets) {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const address = await wallet.getAddress();
    const formattedAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    
    console.log(`\n=== Đang xử lý ví ${walletIndex + 1}/${totalWallets}: ${formattedAddress} ===`.cyan.bold);
    
    for (let i = 1; i <= cycles; i++) {
      console.log(`\n[Ví ${formattedAddress}] Bắt đầu chu kì ${i} / ${cycles}:`.magenta);
      
      try {
        const randomAmount = await getRandomAmount(wallet);
        console.log(`Random amount: ${ethers.utils.formatEther(randomAmount)} MON (1-5% balance)`);
        
        const wrapSuccess = await wrapMON(wallet, randomAmount, i);
        if (!wrapSuccess) {
          console.log(`[Ví ${formattedAddress}] bỏ qua chu kì ${i} do gặp lỗi wrap`.yellow);
          continue;
        }
        
        const unwrapSuccess = await unwrapMON(wallet, randomAmount, i);
        if (!unwrapSuccess) {
          console.log(`[Ví ${formattedAddress}] chu kì ${i} chưa hoàn thành do lỗi unwrap`.yellow);
          continue;
        }
        
        console.log(`[Ví ${formattedAddress}] chu kì ${i} đã hoàn thành`.green);
        
        if (i < cycles) {
          const randomDelay = getRandomDelay();
          console.log(
            `[Ví ${formattedAddress}] cần chờ ${randomDelay / 300 / 60} phút cho chu kì tiếp theo...`.yellow
          );
          await delay(randomDelay);
        }
      } catch (error) {
        console.error(`[Wallet ${formattedAddress}] Error in cycle ${i}:`.red, error.message);
        continue;
      }
    }
    
    console.log(`\n=== Đã hoàn thành tất cả các chu kì cho ví ${formattedAddress} ===`.cyan.bold);
    return true;
  } catch (error) {
    console.error(`Lỗi xử lý ví ${walletIndex + 1}:`.red, error.message);
    return false;
  }
}

async function runSwapCycles(cycles) {
  try {
    console.log("Bắt đầu wrap/unwrap WMON...".green);

    const privateKeys = readPrivateKeys();
    const wallets = privateKeys.map(pk => new ethers.Wallet(pk, provider));

    // Wrap tất cả các ví trước
    console.log("\n🔹 Bắt đầu wrap MON → WMON cho tất cả ví...".cyan);
    for (let i = 0; i < wallets.length; i++) {
      try {
        const randomAmount = await getRandomAmount(wallets[i]);
        console.log(`[Ví ${i + 1}/${wallets.length}] Sẽ wrap: ${ethers.utils.formatEther(randomAmount)} MON`);
        await wrapMON(wallets[i], randomAmount, 1);
      } catch (error) {
        console.error(`[Ví ${i + 1}] Bỏ qua do lỗi lấy số lượng`.yellow);
      }
      await delay(300); // Chờ 1 giây trước khi chuyển sang ví tiếp theo
    }

    console.log("\n🕐 Chờ 10 giây trước khi bắt đầu unwrap...".yellow);
    await delay(300);

    // Unwrap tất cả các ví sau
    console.log("\n🔹 Bắt đầu unwrap WMON → MON cho tất cả ví...".cyan);
    for (let i = 0; i < wallets.length; i++) {
      try {
        const randomAmount = await getRandomAmount(wallets[i]);
        console.log(`[Ví ${i + 1}/${wallets.length}] Sẽ unwrap: ${ethers.utils.formatEther(randomAmount)} WMON`);
        await unwrapMON(wallets[i], randomAmount, 1);
      } catch (error) {
        console.error(`[Ví ${i + 1}] Bỏ qua do lỗi lấy số lượng`.yellow);
      }
      await delay(300); // Chờ 1 giây trước khi chuyển sang ví tiếp theo
    }

    console.log("\n✅ Hoàn thành tất cả các chu kỳ wrap/unwrap cho tất cả ví!".green.bold);
    return true;
  } catch (error) {
    console.error("Thao tác không thành công:".red, error.message);
    return false;
  }
}

async function run() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    "Bạn muốn chạy bao nhiêu chu kỳ trên mỗi ví? ",
    (cycles) => {
      let cyclesCount = cycles ? parseInt(cycles) : 1;
      
      if (isNaN(cyclesCount) || cyclesCount <= 0) {
        console.log("❌ Vui lòng nhập số hợp lệ.".red);
        rl.close();
        return;
      }
      runSwapCycles(cyclesCount);
      
      rl.close();
    }
  );
}


async function runAutomated(cycles = 1, intervalHours = null) {
  try {
    console.log("[Automated] Bắt đầu wrap/unwrap WMON...".green);
    console.log(`[Automated] Chạy ${cycles} chu kì trên mỗi ví`.yellow);
    
    const result = await runSwapCycles(cycles);
    
    if (result && intervalHours) {
      const intervalMs = intervalHours * 60 * 60 * 300;
      console.log(`\n⏱️ Lần chạy tiếp theo được lên lịch sau ${intervalHours} giờ`.cyan);
      setTimeout(() => runAutomated(cycles, intervalHours), intervalMs);
    }
    
    return result;
  } catch (error) {
    console.error("[Automated] Thao tác không thành công:".red, error.message);
    return false;
  }
}

module.exports = {
  run,
  runAutomated,
  wrapMON,
  unwrapMON,
  getRandomAmount,
  getRandomDelay,
};

if (require.main === module) {
  run();
}