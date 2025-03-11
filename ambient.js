const { ethers } = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const WALLET_FILE = "wallet.txt";
const ACCOUNT_SWITCH_DELAY = 3000;

const ROUTER_CONTRACT = "0x88B96aF200c8a9c35442C8AC6cd3D22695AaE4F0";
const USDT_CONTRACT = "0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D";

const availableTokens = {
  MON: { name: "MON", address: null, decimals: 18, native: true },
  USDT: { name: "USDT", address: USDT_CONTRACT, decimals: 6, native: false },
};

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function userCmd(uint16 callpath, bytes calldata cmd) public payable returns (bytes memory)",
  "function acceptCrocDex() public pure returns (bool)",
  "function swap(address base, address quote, uint256 poolIdx, bool isBuy, bool inBaseQty, uint128 qty, uint16 tip, uint128 limitPrice, uint128 minOut, uint8 reserveFlags) external payable returns (int128 baseFlow, int128 quoteFlow)"
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)"
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

function roundAmount(amount, tokenDecimals) {
  try {
    const amountStr = ethers.utils.formatUnits(amount, tokenDecimals);
    
    let roundedValue;
    if (tokenDecimals === 18) {
      roundedValue = Math.ceil(parseFloat(amountStr) * 1000) / 1000;
    } else if (tokenDecimals === 6) {
      roundedValue = Math.ceil(parseFloat(amountStr) * 100) / 100;
    } else {
      roundedValue = Math.ceil(parseFloat(amountStr) * 100) / 100;
    }
    
    return ethers.utils.parseUnits(roundedValue.toString(), tokenDecimals);
  } catch (error) {
    console.error(`❌ Error rounding amount: ${error.message}`.red);
    return amount;
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
      return roundAmount(balance.mul(99).div(100), token.decimals);
    }
    
    const minPercentage = config.transactionLimits.minPercentage;
    const maxPercentage = config.transactionLimits.maxPercentage;
    
    const min = balance.mul(minPercentage * 10).div(1000);
    const max = balance.mul(maxPercentage * 10).div(1000);
    
    const minAmount = ethers.utils.parseUnits("0.0001", token.decimals);
    if (min.lt(minAmount)) {
      console.log("⚠️ Số dư quá thấp, sử dụng số lượng tối thiểu".yellow);
      return roundAmount(minAmount, token.decimals);
    }
    
    const range = max.sub(min);
    const randomValue = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).mod(range);
    const amount = min.add(randomValue);
    
    return roundAmount(amount, token.decimals);
  } catch (error) {
    console.error("❌ Error calculating random amount:".red, error);
    const defaultAmount = ethers.utils.parseUnits("0.01", token.decimals);
    return roundAmount(defaultAmount, token.decimals);
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

async function getTokenBalance(wallet, token, maxRetries = 5) {
    let retries = 0;
    
    while (retries <= maxRetries) {
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
        retries++;
        if (retries > maxRetries) {
          console.error(`❌ Lỗi lấy số dư token ${token.name} sau ${maxRetries} lần thử: ${error.message}`.red);
          return { raw: ethers.BigNumber.from(0), formatted: "0" };
        }
        
        console.log(`⚠️ Lỗi lấy số dư token ${token.name} (lần thử ${retries}/${maxRetries}): ${error.message}`.yellow);
        console.log(`⏱️ Đợi 5 giây trước khi thử lại...`.yellow);
        await delay(5000);
      }
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

function encodeSwapParams(baseToken, quoteToken, amountIn, amountOutMin, isBuy, inBaseQty) {
  const poolIdx = 0x8ca0;
  const tip = 0;
  
  const limitPrice = isBuy 
    ? "0xffff5433e2b3d8211706e6102aa9471" 
    : "0x0000000000000000000000000000001"; 
  
  const reserveFlags = 0; 
  
  const abiCoder = new ethers.utils.AbiCoder();
  
  return abiCoder.encode(
    [
      'address',  
      'address',  
      'uint256',  
      'bool',     
      'bool',     
      'uint128',  
      'uint16',   
      'uint128',  
      'uint128',  
      'uint8'     
    ],
    [
      baseToken,
      quoteToken,
      poolIdx,
      isBuy,
      inBaseQty,
      amountIn,
      tip,
      limitPrice,
      amountOutMin,
      reserveFlags
    ]
  );
}

function encodeSwapParamsFixed(baseToken, quoteToken, amountIn, amountOutMin, isBuy, inBaseQty, limitPrice) {
  const poolIdx = 0x8ca0;
  const tip = 0;
  
  const reserveFlags = 0x02;
  
  const abiCoder = new ethers.utils.AbiCoder();
  
  return abiCoder.encode(
    [
      'address',  
      'address',  
      'uint256',  
      'bool',     
      'bool',     
      'uint128',  
      'uint16',   
      'uint128',  
      'uint128',  
      'uint8'     
    ],
    [
      baseToken,
      quoteToken,
      poolIdx,
      isBuy,
      inBaseQty,
      amountIn,
      tip,
      limitPrice,
      amountOutMin,
      reserveFlags
    ]
  );
}

async function swapTokens(wallet, tokenA, tokenB, amountIn, isToMON = false) {
  try {
    const roundedAmountIn = roundAmount(amountIn, tokenA.decimals);

    if (tokenA.native) {
      return await swapNativeToken(wallet, tokenB, roundedAmountIn);
    }
    
    if (!tokenA.native) {
      const approveSuccess = await approveTokenIfNeeded(wallet, tokenA, roundedAmountIn, ROUTER_CONTRACT);
      if (!approveSuccess) {
        console.log(`❌ Không thể approve token ${tokenA.name}. Bỏ qua giao dịch này.`.red);
        return false;
      }
    }
    
    const routerContract = new ethers.Contract(ROUTER_CONTRACT, ROUTER_ABI, wallet);
    
    let isBuy, inBaseQty;
    let baseAddress, quoteAddress;
    
    if (tokenB.native) {
      isBuy = false; 
      inBaseQty = false;
      baseAddress = ethers.constants.AddressZero;
      quoteAddress = tokenA.address;
    } else if (tokenA.native) {
      isBuy = false;
      inBaseQty = true;
      baseAddress = ethers.constants.AddressZero;
      quoteAddress = tokenB.address;
    } else {
      baseAddress = tokenB.address;
      quoteAddress = tokenA.address;
      isBuy = true;  
      inBaseQty = false;
    }
    
    const minAmountOut = roundedAmountIn.mul(97).div(100);
    
    const formattedAmountIn = ethers.utils.formatUnits(roundedAmountIn, tokenA.decimals);
    
    console.log(`🔄 Swap ${formattedAmountIn} ${tokenA.name} → ${tokenB.name}`.magenta);
    console.log(`Parameters: Base: ${baseAddress}, Quote: ${quoteAddress}, isBuy: ${isBuy}, inBaseQty: ${inBaseQty}`);
    
    const feeData = await wallet.provider.getFeeData();
    const randomGasLimit = Math.floor(Math.random() * (350000 - 250000 + 1)) + 250000;
    const txOverrides = {
      gasLimit: randomGasLimit,
      maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || feeData.gasPrice
    };
    
    if (tokenA.native) {
      txOverrides.value = roundedAmountIn;
    }
    
    try {
      const callpath = 1;
      
      const limitPrice = isBuy 
        ? "0x0000000000000000000000000000010001" 
        : "0x0000000000000000000000000000000001";

      const swapParams = encodeSwapParamsFixed(
        baseAddress,
        quoteAddress,
        roundedAmountIn,
        minAmountOut,
        isBuy,
        inBaseQty,
        limitPrice
      );
      
      const tx = await routerContract.userCmd(callpath, swapParams, txOverrides);
      
      console.log(`🚀 Swap Tx Sent! ${EXPLORER_URL}${tx.hash}`.yellow);
      const receipt = await tx.wait();
      console.log(`✅ Swap ${tokenA.name} → ${tokenB.name} thành công (Block ${receipt.blockNumber})`.green.underline);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi khi gửi giao dịch swap ${tokenA.name} → ${tokenB.name}: ${error.message}`.red);
      return false;
    }
  } catch (error) {
    console.error(`❌ Lỗi swap ${tokenA.name} → ${tokenB.name}:`.red);
    return false;
  }
}

async function swapNativeToken(wallet, targetToken, amountIn) {
  try {
    const roundedAmountIn = roundAmount(amountIn, 18);
    
    console.log(`🔄 Swap ${ethers.utils.formatEther(roundedAmountIn)} MON → ${targetToken.name}...`.magenta);
    
    const routerContract = new ethers.Contract(ROUTER_CONTRACT, ROUTER_ABI, wallet);
    
    const feeData = await wallet.provider.getFeeData();
    const randomGasLimit = Math.floor(Math.random() * (350000 - 250000 + 1)) + 250000;
    const txOverrides = {
      value: roundedAmountIn,
      gasLimit: randomGasLimit,
      maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || feeData.gasPrice
    };
    
    const callpath = 1;
    
    const minAmountOut = roundedAmountIn.mul(95).div(100);
    
    const swapParams = encodeSwapParams(
      ethers.constants.AddressZero,
      targetToken.address,
      roundedAmountIn,
      minAmountOut,
      false,
      true  
    );
    
    const tx = await routerContract.userCmd(callpath, swapParams, txOverrides);
    
    console.log(`✔️ Swap MON → ${targetToken.name} thành công`.green.underline);
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error(`❌ Lỗi swap MON → ${targetToken.name}:`.red, error);
    console.error(error);
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

async function performSwapCycle(wallet, cycleNumber, totalCycles) {
  try {
    console.log(`Chu kì ${cycleNumber} / ${totalCycles}:`.magenta);
    
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