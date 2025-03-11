const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const ethers = require('ethers');
const colors = require('colors');
const solc = require('solc');

// Export the run function that will be called from main.js
exports.run = async function() {
  const chain = {
    RPC_URL: "https://testnet-rpc.monad.xyz",
    CHAIN_ID: 10143,
    SYMBOL: "MON",
    TX_EXPLORER: "https://testnet.monadexplorer.com/tx/",
    ADDRESS_EXPLORER: "https://testnet.monadexplorer.com/address/",
    WMON_ADDRESS: "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701"
  };

  const walletsPath = path.resolve(process.cwd(), 'wallet.txt');

  function readPrivateKeys() {
    try {
      const data = fs.readFileSync(walletsPath, 'utf8');
      const privateKeys = data.split('\n')
        .map(key => key.replace(/\r/g, '').trim())
        .filter(key => key !== '');
      
      return privateKeys;
    } catch (error) {
      console.error(`❌ Không đọc được file wallet.txt: ${error.message}`.red);
      process.exit(1);
    }
  }

  const privateKeys = readPrivateKeys();
  const wallets = privateKeys.map((privateKey, index) => {
    try {
      const tempWallet = new ethers.Wallet(privateKey);
      return {
        id: index + 1,
        privateKey: privateKey,
        address: tempWallet.address
      };
    } catch (error) {
      console.error(`❌ Privatekey không hợp lệ dòng ${index + 1}: ${error.message}`.red);
      return null;
    }
  }).filter(wallet => wallet !== null);

  if (wallets.length === 0) {
    console.error('❌ Không tìm thấy ví trong wallet.txt'.red);
    process.exit(1);
  }

  const contractsPath = path.resolve(__dirname, '../contracts.sol');
  const source = fs.readFileSync(contractsPath, 'utf8');

  const input = {
    language: 'Solidity',
    sources: {
      'contracts.sol': {
        content: source,
      },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode'],
        },
      },
    },
  };

  const compiled = JSON.parse(solc.compile(JSON.stringify(input)));

  if (compiled.errors) {
    let fatal = false;
    compiled.errors.forEach((err) => {
      console.error(err.formattedMessage.red);
      if (err.severity === 'error') fatal = true;
    });
    if (fatal) process.exit(1);
  }

  const contractNames = Object.keys(compiled.contracts['contracts.sol']);
  if (contractNames.length === 0) {
    console.error('❌ Không tìm thấy hợp đồng nào trong quá trình biên dịch.'.red);
    process.exit(1);
  }

  function getConstructorArgs(contractName) {
    switch (contractName) {
      case 'SimpleStorage':
        return [0];
      case 'SimpleCounter':
        return [];
      case 'Greeter':
        return ["Hello"];
      case 'Ownable':
        return [];
      case 'HelloWorld':
        return [];
      case 'BasicCalculator':
        return [];
      case 'DataStore':
        return [123];
      case 'EmptyContract':
        return [];
      case 'SimpleEvent':
        return [];
      case 'SimpleLogger':
        return [];
      default:
        return [];
    }
  }

  // Improved gas price estimation with higher safety buffer
  async function getCurrentGasPrice(provider) {
    try {
      const block = await provider.getBlock('latest');
      const baseFee = block.baseFeePerGas
        ? block.baseFeePerGas
        : ethers.BigNumber.from(0);
      return baseFee.mul(130).div(100); // Increased to 30% buffer for safer estimation
    } catch (error) {
      console.error(`❌ Không thể lấy giá gas hiện tại: ${error.message}`.red);
      return ethers.utils.parseUnits("1", "gwei"); // Safe default
    }
  }

  // Improved deployment cost estimation with higher buffer
  async function estimateDeploymentCost(provider, factory, args, gasLimit) {
    try {
      // Get a more accurate gasLimit if we have a factory
      let finalGasLimit = gasLimit;
      if (factory) {
        try {
          // Try to estimate gas directly if possible
          finalGasLimit = await factory.estimateGas.deploy(...args);
          // Add 30% buffer to estimated gas
          finalGasLimit = finalGasLimit.mul(130).div(100);
        } catch (error) {
          console.log(`⚠️ Không thể ước tính gas chính xác: ${error.message}`.yellow);
        }
      }

      const gasPrice = await getCurrentGasPrice(provider);
      
      // Calculate cost with higher buffer
      const estimatedCost = gasPrice.mul(finalGasLimit);
      // Add additional 20% buffer to the total cost for safety
      const safeEstimatedCost = estimatedCost.mul(120).div(100);
      
      return {
        wei: safeEstimatedCost,
        eth: ethers.utils.formatEther(safeEstimatedCost),
        gasLimit: finalGasLimit
      };
    } catch (error) {
      console.error(`❌ Lỗi ước tính chi phí: ${error.message}`.red);
      // Return a very conservative estimate
      const safeGasPrice = ethers.utils.parseUnits("1.5", "gwei");
      const safeEstimate = safeGasPrice.mul(gasLimit).mul(120).div(100);
      return {
        wei: safeEstimate,
        eth: ethers.utils.formatEther(safeEstimate),
        gasLimit: ethers.BigNumber.from(gasLimit)
      };
    }
  }

  console.log('Inquirer version:', require('inquirer/package.json').version);

  // Main prompt logic
  return inquirer
    .prompt([
      {
        type: 'list',
        name: 'walletChoice',
        message: 'Bạn muốn triển khai hợp đồng trên những ví nào?',
        choices: [
          { name: '1. Tất cả các ví', value: 'all' },
          { name: '2. Một vài ví', value: 'specific' },
        ],
      },
    ])
    .then(async (answers) => {
      let selectedWallets = [];
      if (answers.walletChoice === 'all') {
        selectedWallets = wallets;
      } else {
        const { walletIDs } = await inquirer.prompt([
          {
            type: 'input',
            name: 'walletIDs',
            message: 'Nhập dòng cách nhau bằng dấu cách (ví dụ 1 8 6):',
          },
        ]);
        const ids = walletIDs
          .trim()
          .split(/\s+/)
          .map((id) => parseInt(id.trim()))
          .filter((id) => !isNaN(id));
        selectedWallets = wallets.filter((w) => ids.includes(w.id));
      }

      if (selectedWallets.length === 0) {
        console.log('⚠️ Không có ví nào được chọn để triển khai.'.yellow);
        return;
      }

      const provider = new ethers.providers.JsonRpcProvider(chain.RPC_URL);
      
      // Get a random gas limit in the range [150000, 250000]
      const getRandomGasLimit = () => 
        Math.floor(Math.random() * (250000 - 150000 + 1)) + 150000;

      for (const walletInfo of selectedWallets) {
        const wallet = new ethers.Wallet(walletInfo.privateKey, provider);
        try {
          // Get current balance before estimating
          const balanceBN = await wallet.getBalance();
          const formattedBalance = ethers.utils.formatEther(balanceBN);
          
          const randomIndex = Math.floor(Math.random() * contractNames.length);
          const selectedContractName = contractNames[randomIndex];
          const contractData =
            compiled.contracts['contracts.sol'][selectedContractName];
          const contractABI = contractData.abi;
          const contractBytecode = contractData.evm.bytecode.object;
          const constructorArgs = getConstructorArgs(selectedContractName);

          console.log(
            `\n🏦 Ví - [${walletInfo.address}] đang biên soạn hợp đồng [${selectedContractName}]`
              .green
          );
          console.log('✅ Hợp đồng đã được biên soạn.'.green);
          
          // Create factory first to get better gas estimates
          const factory = new ethers.ContractFactory(
            contractABI,
            contractBytecode,
            wallet
          );
          
          // Get more accurate gas limit and cost estimation
          const initialGasLimit = ethers.BigNumber.from(getRandomGasLimit());
          const costEstimate = await estimateDeploymentCost(
            provider, 
            factory, 
            constructorArgs, 
            initialGasLimit
          );
          
          console.log(`💰 Số dư hiện tại: ${formattedBalance} ${chain.SYMBOL}`.cyan);
          console.log(`💸 Chi phí ước tính: ${costEstimate.eth} ${chain.SYMBOL}`.cyan);
          
          // Check if wallet has enough balance with more conservative estimate
          if (balanceBN.lt(costEstimate.wei)) {
            console.error(
              `❌ Ví - [${walletInfo.address}] không đủ ${chain.SYMBOL} để tạo contract. Cần thêm ${
                ethers.utils.formatEther(costEstimate.wei.sub(balanceBN))
              } ${chain.SYMBOL}`.red
            );
            continue; // Skip to next wallet
          }
          
          console.log('🔨 Chuẩn bị triển khai...'.cyan);

          const block = await provider.getBlock('latest');
          const baseFee = block.baseFeePerGas
            ? block.baseFeePerGas
            : ethers.BigNumber.from(0);
          // Increase gas price buffer to 30%
          const maxFeePerGas = baseFee.mul(130).div(100);
          const maxPriorityFeePerGas = baseFee.mul(130).div(100);

          const contract = await factory.deploy(...constructorArgs, {
            gasLimit: costEstimate.gasLimit,
            maxFeePerGas,
            maxPriorityFeePerGas,
          });

          console.log(
            `🚀 Deploy Tx Sent! - ${chain.TX_EXPLORER}${contract.deployTransaction.hash}`
              .magenta
          );

          const receipt = await contract.deployTransaction.wait();

          console.log(
            `🏠 Hợp đồng được triển khai thành công tại - ${chain.ADDRESS_EXPLORER}${contract.address}\n`
              .magenta
          );
        } catch (error) {
          if (
            (error.message && error.message.includes("insufficient balance")) ||
            error.code === -32603 ||
            (error.message && error.message.includes("CALL_EXCEPTION"))
          ) {
            // Get current balance to display
            const balanceBN = await wallet.getBalance();
            const formattedBalance = ethers.utils.formatEther(balanceBN);
            
            // More descriptive error message with debugging info
            console.error(
              `❌ Ví - [${walletInfo.address}] không đủ ${chain.SYMBOL} để tạo contract. Balance [${formattedBalance}] ${chain.SYMBOL}`.red
            );
            console.error(`💡 Nội dung lỗi chi tiết: ${error.message}`.yellow);
            
            // Add troubleshooting tip
            console.log(`💡 Gợi ý: Thử thủ công với giá gas cao hơn hoặc nạp thêm token`.cyan);
          } else {
            console.error(
              `❌ Lỗi triển khai hợp đồng với ví ${walletInfo.id}: ${error.message}`.red
            );
          }
        }
      }
    });
};