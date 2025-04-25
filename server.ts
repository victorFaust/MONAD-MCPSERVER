// MCP Server for Monad Testnet
// This server implements the Mechanical Continuity Protocol to interact with Monad Testnet
// Based on the official Monad documentation: https://docs.monad.xyz/

import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

// Load environment variables
dotenv.config();

// Constants
const PORT = process.env.PORT || 3000;
// Using the correct Monad Testnet RPC URL
const MONAD_TESTNET_RPC = process.env.MONAD_TESTNET_RPC || 'https://rpc.monad-testnet-1.monad.xyz/';
const PRIVATE_KEY = process.env.PRIVATE_KEY; // Your private key for interacting with the testnet

// Set up Express server
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Connect to Monad Testnet
const provider = new ethers.JsonRpcProvider(MONAD_TESTNET_RPC);
let wallet: ethers.Wallet | null = null;

if (PRIVATE_KEY) {
  wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Wallet connected with address: ${wallet.address}`);
} else {
  console.warn('No private key found. Running in read-only mode.');
}

// Define types for API requests
interface TransactionRequest {
  to: string;
  value: string;
  data?: string;
}

interface ContractCallRequest {
  contractAddress: string;
  abi: any[];
  method: string;
  params?: any[];
}

interface ContractDeployRequest {
  abi: any[];
  bytecode: string;
  constructorArgs?: any[];
}

// MCP Protocol Handler for Monad
class MonadMCPHandler {
  async getNetworkStatus() {
    try {
      const blockNumber = await provider.getBlockNumber();
      const network = await provider.getNetwork();
      // Based on Monad docs, chain ID for testnet is 1838
      return {
        blockNumber,
        chainId: network.chainId,
        networkName: 'Monad Testnet',
        rpcEndpoint: MONAD_TESTNET_RPC
      };
    } catch (error: any) {
      console.error('Error fetching Monad network status:', error);
      throw error;
    }
  }

  async getGasPrice() {
    try {
      const feeData = await provider.getFeeData();
      return {
        gasPrice: feeData.gasPrice?.toString() || '0',
        gasPriceGwei: feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : '0'
      };
    } catch (error: any) {
      console.error('Error fetching gas price:', error);
      throw error;
    }
  }

  async getBalance(address: string) {
    try {
      const balance = await provider.getBalance(address);
      return {
        address,
        balance: ethers.formatEther(balance),
        wei: balance.toString()
      };
    } catch (error: any) {
      console.error(`Error fetching balance for ${address}:`, error);
      throw error;
    }
  }

  async getTransactionCount(address: string) {
    try {
      const count = await provider.getTransactionCount(address);
      return {
        address,
        transactionCount: count
      };
    } catch (error: any) {
      console.error(`Error fetching transaction count for ${address}:`, error);
      throw error;
    }
  }

  async sendTransaction(to: string, value: string, data: string = '0x') {
    if (!wallet) {
      throw new Error('No wallet configured. Cannot send transactions.');
    }

    try {
      // Get current gas price and apply a multiplier for faster confirmation
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      
      if (!gasPrice) {
        throw new Error('Failed to get gas price');
      }
      
      // 1.1x the current gas price (multiply by 110 and divide by 100)
      const adjustedGasPrice = (gasPrice * 110n) / 100n;
      
      const tx = {
        to,
        value: ethers.parseEther(value),
        data,
        gasPrice: adjustedGasPrice,
        // Based on Monad docs, we should specify chain ID explicitly
        chainId: 1838
      };

      const txResponse = await wallet.sendTransaction(tx);
      console.log(`Transaction sent: ${txResponse.hash}`);
      
      return {
        transactionHash: txResponse.hash,
        from: wallet.address,
        to,
        value,
        gasPrice: adjustedGasPrice.toString()
      };
    } catch (error: any) {
      console.error('Error sending transaction:', error);
      throw error;
    }
  }

  async getTransactionReceipt(txHash: string) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      return receipt;
    } catch (error: any) {
      console.error(`Error fetching receipt for transaction ${txHash}:`, error);
      throw error;
    }
  }

  async callContract(contractAddress: string, abi: any[], method: string, params: any[] = []) {
    try {
      const contract = new ethers.Contract(contractAddress, abi, wallet || provider);
      const result = await contract[method](...params);
      return result;
    } catch (error: any) {
      console.error(`Error calling contract method ${method}:`, error);
      throw error;
    }
  }

  async deployContract(abi: any[], bytecode: string, constructorArgs: any[] = []) {
    if (!wallet) {
      throw new Error('No wallet configured. Cannot deploy contracts.');
    }

    try {
      const factory = new ethers.ContractFactory(abi, bytecode, wallet);
      const contract = await factory.deploy(...constructorArgs);
      
      console.log(`Contract deployment transaction: ${contract.deploymentTransaction()?.hash || 'unknown'}`);
      console.log('Waiting for contract deployment...');
      
      // Wait for the contract to be deployed
      await contract.waitForDeployment();
      const deployedAddress = await contract.getAddress();
      
      console.log(`Contract deployed at address: ${deployedAddress}`);
      
      return {
        contractAddress: deployedAddress,
        deploymentTransactionHash: contract.deploymentTransaction()?.hash || 'unknown',
        deployer: wallet.address
      };
    } catch (error: any) {
      console.error('Error deploying contract:', error);
      throw error;
    }
  }
}

const monadMcpHandler = new MonadMCPHandler();

// API Routes
app.get('/api/status', async (req: Request, res: Response) => {
  try {
    const status = await monadMcpHandler.getNetworkStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});

app.get('/api/gasprice', async (req: Request, res: Response) => {
  try {
    const gasPrice = await monadMcpHandler.getGasPrice();
    res.json({
      success: true,
      data: gasPrice
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});

app.get('/api/balance/:address', async (req: Request, res: Response) => {
  try {
    const balance = await monadMcpHandler.getBalance(req.params.address);
    res.json({
      success: true,
      data: balance
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});

app.get('/api/nonce/:address', async  (req: Request, res: Response) => {
  try {
    const txCount = await monadMcpHandler.getTransactionCount(req.params.address);
    res.json({
      success: true,
      data: txCount
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});

app.post('/api/transaction', async (req: Request, res: Response) => {
  try {
    const { to, value, data } = req.body;
    
    if (!to || !value) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: to and value'
      });
    }
    
    const result = await monadMcpHandler.sendTransaction(to, value, data);
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});

app.get('/api/receipt/:txhash', async  (req: Request, res: Response) => {
  try {
    const receipt = await monadMcpHandler.getTransactionReceipt(req.params.txhash);
    if (!receipt) {
      return res.status(404).json({
        success: false,
        error: 'Transaction receipt not found or transaction not confirmed yet'
      });
    }
    res.json({
      success: true,
      data: receipt
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});

app.post('/api/contract/call', async  (req: Request, res: Response)=> {
  try {
    const { contractAddress, abi, method, params } = req.body;
    
    if (!contractAddress || !abi || !method) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: contractAddress, abi, and method'
      });
    }
    
    const result = await monadMcpHandler.callContract(contractAddress, abi, method, params);
    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});

app.post('/api/contract/deploy', async (req: Request, res: Response) => {
    try {
      const { abi, bytecode, constructorArgs } = req.body;
  
      if (!abi || !bytecode) {
        return res.status(400).json({
          success: false,
          error: 'Missing required parameters: abi and bytecode',
        });
      }
  
      const result = await monadMcpHandler.deployContract(abi, bytecode, constructorArgs || []);
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Unknown error',
      });
    }
  });
  
  

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    service: 'monad-mcp-server', 
    network: 'Monad Testnet',
    rpcEndpoint: MONAD_TESTNET_RPC
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Monad MCP Server running on port ${PORT}`);
  console.log(`Connected to Monad Testnet at ${MONAD_TESTNET_RPC}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});