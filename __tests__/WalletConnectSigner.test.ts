import { ethers } from 'ethers';
import { SIGNER_EVENTS, WalletConnectSigner } from '../src/index';
import { WalletClient } from '../src/WalletClient';
import { TestNetwork } from 'ethereum-test-network';
import { ERC20Token__factory } from '../__test__utils__/ERC20Token__factory';

const CHAIN_ID = 123;
const PORT = 8549;
const RPC_URL = `http://localhost:${PORT}`;
const DEFAULT_GENESIS_ACCOUNTS = [
  {
    balance: '0x295BE96E64066972000000',
    privateKey: '0xa3dac6ca0b1c61f5f0a0b3a0acf93c9a52fd94e8e33d243d3b3a8b8c5dc37f0b', // 0xaaE062157B53077da1414ec3579b4CBdF7a4116f
  },
];

const getWalletClient = () => {
  return new WalletClient({
    rpcURL: RPC_URL,
    privateKey: DEFAULT_GENESIS_ACCOUNTS[0].privateKey,
    walletConnectOpts: {
      // storageOptions: {
      //   database: 'WalletClient.db',
      //   tableName: 'test_' + Math.floor(Math.random() * 99999).toString(),
      // },
      logger: 'warn',
    },
  });
};

const getAppClient = () => {
  return new WalletConnectSigner({
    chainId: CHAIN_ID,
    walletConnectOpts: {
      // storageOptions: {
      //   database: 'WalletConnectSigner.db',
      //   tableName: 'test_1',
      // },
      logger: 'warn',
    },
  }).connect(new ethers.providers.JsonRpcProvider(RPC_URL));
};
describe('WalletConnectSigner', () => {
  let testnetwork: TestNetwork;

  beforeEach(async () => {
    testnetwork = await TestNetwork.init({
      chainId: CHAIN_ID,
      port: PORT,
      genesisAccounts: DEFAULT_GENESIS_ACCOUNTS,
    });
  });

  afterEach(async () => {
    await testnetwork.close();
  });

  it('should initiate', async () => {
    const walletClient = getWalletClient();
    const walletConnectSigner = getAppClient();
    console.log(0);
    walletConnectSigner.on(SIGNER_EVENTS.uri, (uri) => {
      return walletClient.pair(uri);
    });
    await walletConnectSigner.open();
    const address = await walletConnectSigner.getAddress();
    await walletClient.close();
    await walletConnectSigner.close();
    expect(address).toContain(new ethers.Wallet(DEFAULT_GENESIS_ACCOUNTS[0].privateKey).address);
  });

  // eslint-disable-next-line jest/no-disabled-tests
  it('should deploy erc20', async () => {
    const walletClient = getWalletClient();
    const walletConnectSigner = getAppClient();
    console.log(0);
    walletConnectSigner.on(SIGNER_EVENTS.uri, (uri) => {
      return walletClient.pair(uri);
    });
    await walletConnectSigner.open();
    const address = await walletConnectSigner.getAddress();
    const erc20Factory = new ERC20Token__factory(walletConnectSigner);
    console.log(2);
    const erc20 = await erc20Factory.deploy('The test token', 'tst', 18);
    console.log(3);
    await erc20.deployed();
    console.log(4);
    const balanceToMint = ethers.utils.parseEther('500');
    console.log(address);
    const mintTx = await erc20.mint(address, balanceToMint);
    await mintTx.wait();
    const tokenBalance = await erc20.balanceOf(address);
    console.log('tokenBalance', tokenBalance.toString());
    await walletConnectSigner.close();
    await walletClient.close();
    expect(tokenBalance.eq(balanceToMint)).toBeTruthy();
  });

  // it('pending request', async () => {
  //   const walletClient = getWalletClient();
  //   const walletConnectSigner = getAppClient();
  //   console.log(0);
  //   walletConnectSigner.on(SIGNER_EVENTS.uri, (uri) => {
  //     console.log('show uri', uri);
  //     // return walletClient.pair(uri);
  //   });
  //   walletConnectSigner.open();

  //   walletConnectSigner.on(SIGNER_EVENTS.uri, (uri) => {
  //     // console.log('show uri', uri);
  //     return walletClient.pair(uri);
  //   });
  //   await walletConnectSigner.open();
  //   const address = await walletConnectSigner.getAddress();
  //   const erc20Factory = new ERC20Token__factory(walletConnectSigner);
  //   console.log(2);
  //   const erc20 = await erc20Factory.deploy('The test token', 'tst', 18);
  //   console.log(3);
  //   await erc20.deployed();
  //   console.log(4);
  //   const balanceToMint = ethers.utils.parseEther('500');
  //   console.log(address);
  //   const mintTx = await erc20.mint(address, balanceToMint);
  //   await mintTx.wait();
  //   const tokenBalance = await erc20.balanceOf(address);
  //   console.log('tokenBalance', tokenBalance.toString());
  //   await walletConnectSigner.close();
  //   await walletClient.close();
  //   expect(tokenBalance.eq(balanceToMint)).toBeTruthy();
  // });
});
