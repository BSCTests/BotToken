import ethers from 'ethers';
import express from 'express';
import chalk from 'chalk';
import dotenv from 'dotenv';
import inquirer from 'inquirer';

const app = express();
dotenv.config();

const data = {
  WBNB: process.env.WBNB_CONTRACT, //wbnb

  AMOUNT_OF_WBNB : process.env.AMOUNT_OF_WBNB, // how much you want to buy in WBNB

  factory: process.env.FACTORY,  //PancakeSwap V2 factory

  router: process.env.ROUTER, //PancakeSwap V2 router

  recipient: process.env.YOUR_ADDRESS, //your wallet address,

  /** COMMON CONFIGURATION */

  gasPrice : ethers.utils.parseUnits(`${process.env.COMMON_GWEI}`, 'gwei'), //in gwei
  
  gasLimit : process.env.COMMON_GAS_LIMIT, //at least 21000

  autoApprove : process.env.COMMON_AUTO_APPROVE, // Enable auto approve of a token to be allowed to sell it.

  /** HARVEST BOT CONFIGURATION */

  harvest_pool_id : process.env.HARVEST_POOL_ID, // Pool id 

  harvest_token_address : process.env.HARVEST_TOKEN_ADDRESS, // FIRST TOKEN ADDRESS (ex : BUSD, BNB, WBNB...)
  
  harvest_token_address_b : process.env.HARVEST_TOKEN_ADDRESS_B, // SECOND TOKEN ADDRESS ( ex : LAVA, FLOKI...)

  harvest_masterchef_address : process.env.HARVEST_MASTERCHEF_ADDRESS, // Masterchef address

  harvest_sell_balance_purcent : process.env.HARVEST_SELL_BALANCE_PURCENT, // Purcent of the balance to sell

  harvest_unlock_block : process.env.HARVEST_SELL_UNLOCK_BLOCK, // Unlock harvest block

  harvest_auto_sell : process.env.HARVEST_AUTO_SELL // Auto sell after withdraw

}

const bscMainnetUrl = 'https://bsc-dataseed1.ninicoin.io/' //https://bsc-dataseed1.defibit.io/ https://bsc-dataseed.binance.org/
//const bscMainnetUrl = 'https://data-seed-prebsc-1-s1.binance.org:8545/' // WHEN TESTNET
const wss = 'wss://bsc-ws-node.nariox.org:443';
const mnemonic = process.env.YOUR_MNEMONIC //your memonic;
//const provider = new ethers.providers.JsonRpcProvider(bscMainnetUrl)
const provider = new ethers.providers.WebSocketProvider(wss);
const wallet = new ethers.Wallet.fromMnemonic(mnemonic);
const account = wallet.connect(provider);
const tokenWBNB = data.WBNB;


const factory = new ethers.Contract(
    data.factory,
    [
      'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
      'function getPair(address tokenA, address tokenB) external view returns (address pair)',
    ],
    account
  );

const router = new ethers.Contract(
  data.router,
  [
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint[] memory amounts)'
  ],
  account
);

const erc = new ethers.Contract(
  data.WBNB,
  [
    'function balanceOf(address tokenOwner) external view returns (uint256)',
    'function approve(address spender, uint amount) public returns(bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',

  ],
  account
);  

 const tokenOutContract = new ethers.Contract(
  data.harvest_token_address_b,
  [
  'function balanceOf(address tokenOwner) external view returns (uint256)',
  'function approve(address spender, uint amount) public returns(bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  ],
  account
);  


const masterChefContract = new ethers.Contract(
    data.harvest_masterchef_address,
    [
    'function userInfo(uint poolId, address tokenOwner) external view returns (uint256 amountInPool, uint256 rewardDebt, uint256 rewardLockedUp)',
    'function withdraw(uint poolId, uint amountInPool) external returns (bool)',
    ],
    account
);

const beforeRun = async() => {
  if(parseInt(data.autoApprove) !== 0){
    console.log(chalk.yellow.inverse(`Checking if WBNB is already approved...`));
    let isWBNBApproved = false;
    const isWBNBApprovedTx = await erc.allowance(
      data.recipient,
      data.router
    );
    isWBNBApproved = isWBNBApprovedTx.toString() > 0 ? true : false;
    if(isWBNBApproved === false) {
      console.log(chalk.yellow.inverse(`WBNB was not approved...`));
      console.log(chalk.yellow.inverse(`Approving WBNB...`));
      const txApprove = await erc.approve(
        data.router,
        ethers.constants.MaxUint256
      );
      const txApproveReceipt = await txApprove.wait();
      console.log(chalk.green.inverse(`Transaction APPROVE receipt : https://www.bscscan.com/tx/${txApproveReceipt.transactionHash}`));
    }
    console.log(chalk.green.inverse(`WBNB was already approved...`));
    console.log(chalk.green.inverse(`Continuing the process...`));

    if(parseInt(data.enableAutoSell) !== 0){
      console.log(chalk.yellow.inverse(`Checking if token is already approved...`));
      let isTokenSwapApproved
      const isTokenSwapApprovedTx = await tokenOutContract.allowance(
        data.recipient,
        data.router
      );
      isTokenSwapApproved = isTokenSwapApprovedTx.toString() > 0 ? true : false;
      if(isTokenSwapApproved === false) {
        console.log(chalk.yellow.inverse(`Token was not approved...`));
        console.log(chalk.yellow.inverse(`Approving token...`));
        const txApprove = await tokenOutContract.approve(
          data.router,
          ethers.constants.MaxUint256
        );
        const txApproveReceipt = await txApprove.wait();
        console.log(chalk.green.inverse(`Transaction APPROVE receipt : https://www.bscscan.com/tx/${txApproveReceipt.transactionHash}`));
      }
      console.log(chalk.green.inverse(`Token was already approved...`));
      console.log(chalk.green.inverse(`Continuing the process...`));
    } 
  }
  setTimeout(() => run(), 3000);
}
const run = async () => {
  await checkHarvestBlock();
}

let checkHarvestBlock = async() => {
  // Recuperer le block actuel
  let currentBlock = (await provider.getBlockNumber()).toString();

  // Comparer avec le block du unlock
  console.log(chalk.blue.inverse(`Comparing current block with unlock block ...`));
  if ( currentBlock >= data.harvest_unlock_block ) {
      console.log(chalk.green.inverse(`Current block : ` + currentBlock + ` >=  ` + data.harvest_unlock_block + ` : Unlock Block ` ));
      console.log(chalk.green.inverse(`Harvest is possible !`));
      setTimeout(() => harvestAction(), 3000);
  } else {
      console.log(chalk.red.inverse(`Cannot harvest yet...`));
      return await checkHarvestBlock();
  } 
}

let harvestAction = async() => {
      // Montant a withdraw
      let userInfos = await masterChefContract.userInfo(1, data.recipient);
      console.log(chalk.yellow.inverse(`Withdrawing...` ));

      // Masterchef contract => Withdraw (La fonction withdraw recupere les rewards aussi, est ce que ca harvest ??? Bonne Question)
      const tx = await masterChefContract.withdraw(
      data.harvest_pool_id,
      userInfos[0].toString()
      );
    
    const receipt = await tx.wait(); 
    console.log(chalk.green.inverse(`Transaction Withdraw receipt : https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`));

    setTimeout(() => removeLiquidityAction(), 3000);
}

let removeLiquidityAction = async() => {
  // Recuperation de la paire de liquidité
  let harvest_pair_address = await factory.getPair(data.harvest_token_address, data.harvest_token_address_b);
  let liquidityPoolContract = await new ethers.Contract(
    harvest_pair_address,
    [
      'function balanceOf(address tokenOwner) external view returns (uint256)',
      'function allowance(address owner, address spender) external view returns (uint256)',
    ],
    account
  )

  // Approve LP Token
  console.log(chalk.yellow.inverse(`Checking if LP Token is already approved...`));
  let isLPTokenApproved = false;
  const isLPTokenApprovedTx = await liquidityPoolContract.allowance(
    data.recipient,
    data.router
  );
  isLPTokenApproved = isLPTokenApprovedTx.toString() > 0 ? true : false;
  if(isLPTokenApproved === false) {
    console.log(chalk.yellow.inverse(`LP Token was not approved...`));
    console.log(chalk.yellow.inverse(`Approving LP Token...`));
    const txApprove = await erc.approve(
      data.router,
      ethers.constants.MaxUint256
    );
    const txApproveReceipt = await txApprove.wait();
    console.log(chalk.green.inverse(`Transaction APPROVE LP Token receipt : https://www.bscscan.com/tx/${txApproveReceipt.transactionHash}`));
  }
  console.log(chalk.green.inverse(`LP Token was already approved...`));
  console.log(chalk.green.inverse(`Continuing the process...`));

  // Recuperation de la balance de la paire de liquidité
  let liquidity_token_balance = await liquidityPoolContract.balanceOf(data.recipient); 
    try{
      const tx = await router.removeLiquidity(
          data.harvest_token_address,
          data.harvest_token_address_b,
          liquidity_token_balance.toString(),
          0,
          0,
          data.recipient,
          Date.now() + 1000 * 60 * 5,
          {
            'gasLimit': data.gasLimit,
            'gasPrice': data.gasPrice,
              'nonce' : null //set you want buy at where position in blocks
          }
        );
        
        const receipt = await tx.wait(); 
        console.log(chalk.green.inverse(`Transaction LP Token Removed receipt : https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`));
        setTimeout(() => sellAction(), 3000);
  }catch(err){
    let error = JSON.parse(JSON.stringify(err));
      console.log(`Error caused by : 
      {
      reason : ${error.reason},
      transactionHash : ${error.transactionHash}
      message : Error when removing liquidity
      }`);
      console.log(error);

      inquirer.prompt([
  {
    type: 'confirm',
    name: 'runAgain',
    message: 'Do you want to run again this bot?',
  },
])
.then(answers => {
  if(answers.runAgain === true){
    console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
    console.log('Run again');
    console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
    run();
  }else{
    process.exit();
  }

});

  } 
}

let sellAction = async() => {

  // Pourcent de la balance a vendre
  let purcentToSell = parseFloat(data.harvest_sell_balance_purcent/100);

  // Recuperation de la balance
  const txBalanceOf = await tokenOutContract.balanceOf(
      data.recipient
  );
  // Montant actuel de token
  let currentTokenAmount = txBalanceOf;

  // Calcul du montant de token a vendre
  let amountTokenToSell = (currentTokenAmount.toString() * purcentToSell).toFixed();

  if ( amountTokenToSell >= currentTokenAmount.toString()) {
    amountTokenToSell = currentTokenAmount.toString();
  }

  // Vente du pourcentage de token
  try{
      console.log(
        chalk.red.inverse(`Start to sell \n`)
        +
        `Selling Token
        =================
      `);
      
      console.log('Processing Transaction.....');
      console.log(chalk.yellow(`data.recipient: ${data.recipient}`));
      console.log(chalk.yellow(`data.gasLimit: ${data.gasLimit}`));
      console.log(chalk.yellow(`data.gasPrice: ${data.gasPrice}`));

       const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens( 
        amountTokenToSell,
        0,
        [data.harvest_token_address_b, tokenWBNB],
        data.recipient,
        Date.now() + 1000 * 60 * 5, //5 minutes
        {
          'gasLimit': data.gasLimit,
          'gasPrice': data.gasPrice,
            'nonce' : null //set you want buy at where position in blocks
      });
      
      const receipt = await tx.wait();
      console.log(chalk.green.inverse(`Transaction SELL receipt : https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`));
      setTimeout(() => {process.exit()},2000);
    }catch(err){
      let error = JSON.parse(JSON.stringify(err));
        console.log(`Error caused by : 
        {
        reason : ${error.reason},
        transactionHash : ${error.transactionHash}
        message : Selling error, check if the token is approved or if you have enough BNB for transaction
        }`);
        console.log(error);

        inquirer.prompt([
    {
      type: 'confirm',
      name: 'runAgain',
      message: 'Do you want to run again thi bot?',
    },
  ])
  .then(answers => {
    if(answers.runAgain === true){
      console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
      console.log('Run again');
      console.log('= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =');
      run();
    }else{
      process.exit();
    }

  });

    }
} 

beforeRun();

const PORT = 5001;

app.listen(PORT, console.log(chalk.yellow(`Waiting for harvest to unlock.`)));
