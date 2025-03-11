const { ethers } = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const WALLET_FILE = "wallet.txt";
const ACCOUNT_SWITCH_DELAY = 3000;

const ROUTER_CONTRACT = "0xCa810D095e90Daae6e867c19DF6D9A8C56db2c89";
const WMON_CONTRACT = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
const USDC_CONTRACT = "0x62534E4bBD6D9ebAC0ac99aeaa0aa48E56372df0";
const BEAN_CONTRACT = "0x268E4E24E0051EC27b3D27A95977E71cE6875a05";
const JAI_CONTRACT = "0x70F893f65E3C1d7f82aad72f71615eb220b74D10";

const availableTokens = {
  MON: { name: "MON", address: null, decimals: 18, native: true },
  WMON: { name: "WMON", address: WMON_CONTRACT, decimals: 18, native: false },
  USDC: { name: "USDC", address: USDC_CONTRACT, decimals: 6, native: false },
  BEAN: { name: "BEAN", address: BEAN_CONTRACT, decimals: 18, native: false },
  JAI: { name: "JAI", address: JAI_CONTRACT, decimals: 6, native: false },
};

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint amount) returns (bool)"
];

const WMON_ABI = [
  "function deposit() public payable",
  "function withdraw(uint256 amount) public",
  "function balanceOf(address owner) view returns (uint256)"
];

function readPrivateKeys() {
  try {
    const data = fs.readFileSync(WALLET_FILE, 'utf8');
    const privateKeys = data.split('\n')
      .map(key => key.trim())
      .filter(key => key !== '');
    
    return privateKeys;
  } catch (error) {
    console.error(`❌ Không đọc được file wallet.txt: ${error.message}`.red);
    process.exit(1);
  }
}

async function getRandomAmount(wallet, token, isToMON = false) {
  try {
    let balance;
    if (token.native) {
      balance = await wallet.getBalance();
    } else {
      const tokenContract = new ethers.Contract(token.address, ERC20_ABI, wallet);
      balance = await tokenContract.balanceOf(wallet.address);
    }
    
    if (isToMON) {
      return balance.mul(99).div(100);
    }
    
    const minPercentage = config.transactionLimits.minPercentage;
    const maxPercentage = config.transactionLimits.maxPercentage;
    
    const min = balance.mul(minPercentage * 10).div(1000); // minPercentage% of balance
    const max = balance.mul(maxPercentage * 10).div(1000); // maxPercentage% of balance
    
    const minAmount = ethers.utils.parseUnits("0.0001", token.decimals);
    if (min.lt(minAmount)) {
      console.log("⚠️ Số dư quá thấp, sử dụng số lượng tối thiểu".yellow);
      return minAmount;
    }
    
    const range = max.sub(min);
    const randomValue = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).mod(range);
    const amount = min.add(randomValue);
    
    return amount;
  } catch (error) {
    console.error("❌ Error calculating random amount:".red, error);
    return ethers.utils.parseUnits("0.01", 18);
  }
}

function getRandomDelay() {
  const minDelay = 30 * 1000;
  const maxDelay = 1 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTokenBalance(wallet, token) {
  try {
    if (token.native) {
      const balance = await wallet.provider.getBalance(wallet.address);
      return {
        raw: balance,
        formatted: ethers.utils.formatUnits(balance, token.decimals)
      };
    } else {
      const tokenContract = new ethers.Contract(token.address, ERC20_ABI, wallet);
      const balance = await tokenContract.balanceOf(wallet.address);
      return {
        raw: balance,
        formatted: ethers.utils.formatUnits(balance, token.decimals)
      };
    }
  } catch (error) {
    console.error(`❌ Lỗi lấy số dư token ${token.name}: ${error.message}`.red);
    return { raw: ethers.BigNumber.from(0), formatted: "0" };
  }
}

async function approveTokenIfNeeded(wallet, token, amount, routerAddress) {
  if (token.native) return true;
  
  try {
    const tokenContract = new ethers.Contract(token.address, ERC20_ABI, wallet);
    const allowance = await tokenContract.allowance(wallet.address, routerAddress);
    
    if (allowance.lt(amount)) {
      console.log(`⚙️ Đang approve token ${token.name}...`.cyan);
      const tx = await tokenContract.approve(routerAddress, ethers.constants.MaxUint256);
      console.log(`🚀 Approve Tx Sent! ${EXPLORER_URL}${tx.hash}`.yellow);
      await tx.wait();
      console.log(`✅ Token ${token.name} đã được approved`.green);
    } else {
      console.log(`✅ Token ${token.name} đã được approved từ trước`.green);
    }
    return true;
  } catch (error) {
    console.error(`❌ Lỗi approve token ${token.name}: ${error.message}`.red);
    return false;
  }
}

async function wrapMON(amount, wallet) {
  try {
    console.log(`🔄 Wrap ${ethers.utils.formatEther(amount)} MON → WMON...`.magenta);
    const wmonContract = new ethers.Contract(WMON_CONTRACT, WMON_ABI, wallet);
    const tx = await wmonContract.deposit({ value: amount, gasLimit: 500000 });
    console.log(`✔️ Wrap MON → WMON thành công`.green.underline);
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Lỗi wrap MON:".red, error);
    return false;
  }
}

async function unwrapMON(amount, wallet) {
  try {
    console.log(`🔄 Unwrap ${ethers.utils.formatEther(amount)} WMON → MON...`.magenta);
    const wmonContract = new ethers.Contract(WMON_CONTRACT, WMON_ABI, wallet);
    const tx = await wmonContract.withdraw(amount, { gasLimit: 500000 });
    console.log(`✔️ Unwrap WMON → MON thành công`.green.underline);
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Lỗi unwrap WMON:".red, error);
    return false;
  }
}

async function swapTokens(wallet, tokenA, tokenB, amountIn, isToMON = false) {
  try {
    if (tokenA.native && tokenB.name === "WMON") {
      return await wrapMON(amountIn, wallet);
    }
    
    if (tokenA.name === "WMON" && tokenB.native) {
      return await unwrapMON(amountIn, wallet);
    }
    
    if (!tokenA.native) {
      const approveSuccess = await approveTokenIfNeeded(wallet, tokenA, amountIn, ROUTER_CONTRACT);
      if (!approveSuccess) {
        console.log(`❌ Không thể approve token ${tokenA.name}. Bỏ qua giao dịch này.`.red);
        return false;
      }
    }
    
    const routerContract = new ethers.Contract(ROUTER_CONTRACT, ROUTER_ABI, wallet);
    const currentTime = Math.floor(Date.now() / 1000);
    const deadline = currentTime + 6 * 3600;
    
    let path = [];
    if (tokenA.native) {
      path.push(WMON_CONTRACT);
    } else {
      path.push(tokenA.address);
    }
    
    if (tokenB.native) {
      path.push(WMON_CONTRACT);
    } else {
      path.push(tokenB.address);
    }
    
    let expectedOut, minAmountOut;
    try {
      const amountsOut = await routerContract.getAmountsOut(amountIn, path);
      expectedOut = amountsOut[amountsOut.length - 1];
      minAmountOut = expectedOut.mul(95).div(100);
    } catch (error) {
      console.error(`❌ Lỗi khi lấy amountsOut cho ${tokenA.name} → ${tokenB.name}: ${error.message}`.red);
      console.log(`⚠️ Có thể là do thiếu thanh khoản hoặc cặp token không hỗ trợ. Thử cặp token khác.`.yellow);
      return false;
    }
    
    const formattedAmountIn = ethers.utils.formatUnits(amountIn, tokenA.decimals);
    const formattedAmountOut = ethers.utils.formatUnits(expectedOut, tokenB.decimals);
    
    console.log(`🔄 Swap ${formattedAmountIn} ${tokenA.name} → ${formattedAmountOut} ${tokenB.name}`.magenta);
    
    const feeData = await wallet.provider.getFeeData();
    const randomGasLimit = Math.floor(Math.random() * (350000 - 250000 + 1)) + 250000;
    const txOverrides = {
      gasLimit: randomGasLimit,
      maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || feeData.gasPrice
    };
    
    let tx;
    try {
      if (tokenA.native) {
        tx = await routerContract.swapExactETHForTokens(
          minAmountOut,
          path,
          wallet.address,
          deadline,
          { value: amountIn, ...txOverrides }
        );
      } else if (tokenB.native) {
        tx = await routerContract.swapExactTokensForETH(
          amountIn,
          minAmountOut,
          path,
          wallet.address,
          deadline,
          txOverrides
        );
      } else {
        tx = await routerContract.swapExactTokensForTokens(
          amountIn,
          minAmountOut,
          path,
          wallet.address,
          deadline,
          txOverrides
        );
      }
      
      console.log(`🚀 Swap Tx Sent! ${EXPLORER_URL}${tx.hash}`.yellow);
      const receipt = await tx.wait();
      console.log(`✅ Swap ${tokenA.name} → ${tokenB.name} thành công (Block ${receipt.blockNumber})`.green.underline);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi khi gửi giao dịch swap ${tokenA.name} → ${tokenB.name}: ${error.message}`.red);
      return false;
    }
  } catch (error) {
    console.error(`❌ Lỗi swap ${tokenA.name} → ${tokenB.name}:`.red, error);
    return false;
  }
}

async function swapMonToToken(wallet, token) {
  try {
    console.log(`⚠️ Số dư ${token.name} quá thấp để thực hiện giao dịch`.yellow);
    console.log(`🔄 Đang swap MON sang ${token.name} để tiếp tục giao dịch...`.cyan);
    
    const monBalance = await getTokenBalance(wallet, availableTokens.MON);
    if (monBalance.raw.isZero() || monBalance.raw.lt(ethers.utils.parseUnits("0.001", 18))) {
      console.log(`❌ Số dư MON quá thấp để thực hiện swap`.red);
      return false;
    }
    
    const randomAmount = await getRandomAmount(wallet, availableTokens.MON);
    const swapSuccess = await swapTokens(wallet, availableTokens.MON, token, randomAmount);
    
    if (swapSuccess) {
      const newBalance = await getTokenBalance(wallet, token);
      console.log(`✅ Đã swap MON sang ${token.name}. Số dư mới: ${newBalance.formatted} ${token.name}`.green);
      return true;
    } else {
      console.log(`❌ Không thể swap MON sang ${token.name}`.red);
      return false;
    }
  } catch (error) {
    console.error(`❌ Lỗi khi swap MON sang ${token.name}: ${error.message}`.red);
    return false;
  }
}

async function getRandomTokenPair() {
  const tokenKeys = Object.keys(availableTokens);
  const tokenAIndex = Math.floor(Math.random() * tokenKeys.length);
  let tokenBIndex;
  
  do {
    tokenBIndex = Math.floor(Math.random() * tokenKeys.length);
  } while (tokenBIndex === tokenAIndex);
  
  return [availableTokens[tokenKeys[tokenAIndex]], availableTokens[tokenKeys[tokenBIndex]]];
}

async function checkAndSwapToMON(wallet) {
  try {
    console.log(`🔍 Kiểm tra và swap các token có giá trị cao về MON...`.cyan);
    
    for (const tokenKey in availableTokens) {
      const token = availableTokens[tokenKey];
      if (token.native || token.name === "WMON") continue;
      
      const tokenBalance = await getTokenBalance(wallet, token);
      if (tokenBalance.raw.isZero()) continue;
      
      try {
        const routerContract = new ethers.Contract(ROUTER_CONTRACT, ROUTER_ABI, wallet);
        const path = [token.address, WMON_CONTRACT];
        const amountsOut = await routerContract.getAmountsOut(tokenBalance.raw, path);
        const estimatedMONValue = amountsOut[amountsOut.length - 1];
        const estimatedMONFormatted = ethers.utils.formatEther(estimatedMONValue);
        
        console.log(`💰 Số dư ${token.name}: ${tokenBalance.formatted} (≈ ${estimatedMONFormatted} MON)`.cyan);
        
        if (estimatedMONValue.gt(ethers.utils.parseEther("0.5"))) {
          console.log(`⚠️ Phát hiện ${token.name} có giá trị lớn hơn 0.5 MON, đang swap về MON...`.yellow);
          
          const approveSuccess = await approveTokenIfNeeded(wallet, token, tokenBalance.raw, ROUTER_CONTRACT);
          if (!approveSuccess) {
            console.log(`❌ Không thể approve token ${token.name}. Bỏ qua token này.`.red);
            continue;
          }
          
          const amountToSwap = tokenBalance.raw.mul(99).div(100);
          const swapSuccess = await swapTokens(wallet, token, availableTokens.MON, amountToSwap, true);
          
          if (swapSuccess) {
            console.log(`✅ Đã swap ${token.name} về MON thành công`.green);
          } else {
            console.log(`❌ Không thể swap ${token.name} về MON`.red);
          }
        }
      } catch (error) {
        console.log(`⚠️ Lỗi kiểm tra giá trị của ${token.name}: ${error.message}`.yellow);
        continue;
      }
    }
    
    try {
      const wmonToken = availableTokens.WMON;
      const wmonBalance = await getTokenBalance(wallet, wmonToken);
      
      if (!wmonBalance.raw.isZero() && wmonBalance.raw.gt(ethers.utils.parseEther("0.5"))) {
        console.log(`💰 Số dư WMON: ${wmonBalance.formatted} (= ${wmonBalance.formatted} MON)`.cyan);
        console.log(`⚠️ Phát hiện WMON có giá trị lớn hơn 0.5 MON, đang unwrap về MON...`.yellow);
        
        const amountToUnwrap = wmonBalance.raw.mul(99).div(100);
        const unwrapSuccess = await unwrapMON(amountToUnwrap, wallet);
        
        if (unwrapSuccess) {
          console.log(`✅ Đã unwrap WMON về MON thành công`.green);
        } else {
          console.log(`❌ Không thể unwrap WMON về MON`.red);
        }
      }
    } catch (error) {
      console.log(`⚠️ Lỗi kiểm tra và unwrap WMON: ${error.message}`.yellow);
    }
    
    const monBalance = await getTokenBalance(wallet, availableTokens.MON);
    console.log(`💰 Số dư MON sau khi kiểm tra: ${monBalance.formatted} MON`.cyan);
    
    return true;
  } catch (error) {
    console.error(`❌ Lỗi kiểm tra và swap token: ${error.message}`.red);
    return false;
  }
}

async function performSwapCycle(wallet, cycleNumber, totalCycles) {
  try {
    console.log(`Chu kì ${cycleNumber} / ${totalCycles}:`.magenta);
    
    await checkAndSwapToMON(wallet);
    
    const [tokenA, tokenB] = await getRandomTokenPair();
    console.log(`🔀 Đã chọn cặp giao dịch: ${tokenA.name} → ${tokenB.name}`.cyan);
    
    const balanceA = await getTokenBalance(wallet, tokenA);
    console.log(`💰 Số dư ${tokenA.name}: ${balanceA.formatted}`.cyan);
    
    let continueWithTokenA = true;
    if (balanceA.raw.isZero() || balanceA.raw.lt(ethers.utils.parseUnits("0.0001", tokenA.decimals))) {
      if (!tokenA.native) {
        continueWithTokenA = await swapMonToToken(wallet, tokenA);
      } else {
        console.log(`⚠️ Số dư MON quá thấp để thực hiện giao dịch`.yellow);
        continueWithTokenA = false;
      }
      
      if (!continueWithTokenA) {
        console.log(`❌ Không thể tiếp tục với token ${tokenA.name}, thử cặp token khác`.yellow);
        return await retryWithDifferentPair(wallet, tokenA);
      }
    }
    
    const isToNative = tokenB.native;
    const randomAmount = await getRandomAmount(wallet, tokenA, isToNative);
    
    const swapSuccess = await swapTokens(wallet, tokenA, tokenB, randomAmount, isToNative);
    if (!swapSuccess) {
      console.log(`❌ Swap ${tokenA.name} → ${tokenB.name} thất bại, thử cặp token khác`.yellow);
      return await retryWithDifferentPair(wallet, tokenA);
    }
    
    const randomDelay = getRandomDelay();
    console.log(`⏱️ Đợi ${Math.floor(randomDelay / 1000)} giây...`.cyan);
    await delay(randomDelay);
    
    const balanceB = await getTokenBalance(wallet, tokenB);
    console.log(`💰 Số dư ${tokenB.name}: ${balanceB.formatted}`.cyan);
    
    let continueWithTokenB = true;
    if (balanceB.raw.isZero() || balanceB.raw.lt(ethers.utils.parseUnits("0.0001", tokenB.decimals))) {
      if (!tokenB.native) {
        continueWithTokenB = await swapMonToToken(wallet, tokenB);
      } else {
        console.log(`⚠️ Số dư MON quá thấp để thực hiện giao dịch ngược lại`.yellow);
        continueWithTokenB = false;
      }
      
      if (!continueWithTokenB) {
        console.log(`⚠️ Không thể swap ngược lại, nhưng giao dịch ban đầu đã thành công`.yellow);
        return true;
      }
    }
    
    const isReversalToNative = tokenA.native;
    const reverseAmount = await getRandomAmount(wallet, tokenB, isReversalToNative);
    const reverseSwapSuccess = await swapTokens(wallet, tokenB, tokenA, reverseAmount, isReversalToNative);
    
    if (!reverseSwapSuccess) {
      console.log(`⚠️ Swap ngược ${tokenB.name} → ${tokenA.name} thất bại`.yellow);
      return true;
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Lỗi chu kỳ swap: ${error.message}`.red);
    return false;
  }
}

async function retryWithDifferentPair(wallet, excludeToken) {
  try {
    console.log(`🔄 Thử lại với cặp token khác...`.cyan);
    
    await checkAndSwapToMON(wallet);
    
    const validTokens = Object.values(availableTokens).filter(token => token.name !== excludeToken.name);
    if (validTokens.length < 2) {
      console.log(`⚠️ Không đủ token hợp lệ để thử lại`.yellow);
      return false;
    }
    
    const tokenAIndex = Math.floor(Math.random() * validTokens.length);
    const tokenA = validTokens[tokenAIndex];
    
    let tokenBIndex;
    do {
      tokenBIndex = Math.floor(Math.random() * validTokens.length);
    } while (tokenBIndex === tokenAIndex);
    const tokenB = validTokens[tokenBIndex];
    
    console.log(`🔀 Thử lại với cặp: ${tokenA.name} → ${tokenB.name}`.cyan);
    
    const balanceA = await getTokenBalance(wallet, tokenA);
    console.log(`💰 Số dư ${tokenA.name}: ${balanceA.formatted}`.cyan);
    
    let continueWithTokenA = true;
    if (balanceA.raw.isZero() || balanceA.raw.lt(ethers.utils.parseUnits("0.0001", tokenA.decimals))) {
      if (!tokenA.native) {
        continueWithTokenA = await swapMonToToken(wallet, tokenA);
      } else {
        console.log(`⚠️ Số dư MON quá thấp để thực hiện giao dịch`.yellow);
        continueWithTokenA = false;
      }
      
      if (!continueWithTokenA) {
        console.log(`❌ Không thể tiếp tục với token ${tokenA.name}`.yellow);
        return false;
      }
    }
    
    const isToNative = tokenB.native;
    const randomAmount = await getRandomAmount(wallet, tokenA, isToNative);
    
    return await swapTokens(wallet, tokenA, tokenB, randomAmount, isToNative);
  } catch (error) {
    console.error(`❌ Lỗi khi thử lại: ${error.message}`.red);
    return false;
  }
}

async function runSwapCyclesForAccount(privateKey, cycles) {
  try {
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);

    const address = wallet.address;
    const truncatedAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    console.log(`\n👤 Đang xử lý tài khoản: ${truncatedAddress}`.cyan);
    
    const balance = await wallet.getBalance();
    console.log(`💰 Balance: ${ethers.utils.formatEther(balance)} MON`.cyan);
    
    await checkAndSwapToMON(wallet);

    let completedCycles = 0;
    for (let i = 0; i < cycles; i++) {
      const success = await performSwapCycle(wallet, i + 1, cycles);
      if (success) {
        completedCycles++;
      } else {
        console.log(`⚠️ Chu kỳ ${i + 1} thất bại, chuyển sang chu kỳ tiếp theo`.yellow);
      }
      
      if (i < cycles - 1) {
        const cycleDelay = getRandomDelay() * 2;
        console.log(`⏱️ Đợi ${Math.floor(cycleDelay / 1000)} giây trước chu kỳ tiếp theo...`.cyan);
        await delay(cycleDelay);
      }
    }
    
    console.log(`✅ Hoàn thành ${completedCycles}/${cycles} chu kì cho tài khoản ${truncatedAddress}`.green);
    return true;
  } catch (error) {
    console.error(`❌ Lỗi xử lý tài khoản, xem lại privatekey đã đúng chưa ${privateKey.substring(0, 6)}...: ${error.message}`.red);
    return false;
  }
}

async function processAllAccounts(cycles, interval) {
  try {
    const privateKeys = readPrivateKeys();
    console.log(`📋 Tìm thấy ${privateKeys.length} tài khoản trong wallet.txt`.cyan);
    
    for (let i = 0; i < privateKeys.length; i++) {
      console.log(`\n🔄 Đang xử lý tài khoản ${i + 1} of ${privateKeys.length}`.cyan);
      const success = await runSwapCyclesForAccount(privateKeys[i], cycles);
      
      if (!success) {
        console.log(`⚠️ Không thể xử lý tài khoản ${i + 1}, chuyển sang tài khoản tiếp theo`.yellow);
      }
      
      if (i < privateKeys.length - 1) {
        console.log(`⏱️ Chờ 3 giây trước khi chuyển sang tài khoản tiếp theo...`.cyan);
        await delay(ACCOUNT_SWITCH_DELAY);
      }
    }
    
    if (interval) {
      console.log(`\n⏱️ Tất cả các tài khoản được xử lý. Đợt tiếp theo sẽ chạy vào ${interval} giờ`.cyan);
      setTimeout(() => processAllAccounts(cycles, interval), interval * 60 * 60 * 1000);
    } else {
      console.log(`\n✅ Tất cả các tài khoản được xử lý thành công`.green.bold);
    }
  } catch (error) {
    console.error(`❌ Lỗi rồi: ${error.message}`.red);
  }
}

function run() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    "Bạn muốn thực hiện bao nhiêu chu kỳ cho mỗi tài khoản? (Enter mặc định 1): ",
    (cycles) => {
      rl.question(
        "Bạn muốn mỗi chu kì chạy bao lâu một lần (tính bằng giờ)? (Nhấn enter để chạy luôn): ",
        (hours) => {
          let cyclesCount = cycles ? parseInt(cycles) : 1;
          let intervalHours = hours ? parseInt(hours) : null;

          if (
            isNaN(cyclesCount) ||
            (intervalHours !== null && isNaN(intervalHours))
          ) {
            console.log("❌ Vui lòng nhập số hợp lệ.".red);
            rl.close();
            return;
          }
          
          processAllAccounts(cyclesCount, intervalHours);
          rl.close();
        }
      );
    }
  );
}

async function runAutomated(cycles = 1, intervalHours = null) {
  await processAllAccounts(cycles, intervalHours);
  return true;
}

module.exports = { 
  run, 
  runAutomated 
};

if (require.main === module) {
  run();
}