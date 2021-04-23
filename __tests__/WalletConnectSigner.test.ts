import { ethers } from 'ethers';
import { WalletConnectSigner } from '../src/index';
import { WalletClient } from '../src/WalletClient';
import { TestNetwork } from 'ethereum-test-network';
import { ERC20Token__factory } from '../__test__utils__/ERC20Token__factory';

const CHAIN_ID = 123;
const PORT = 8545;
const RPC_URL = `http://localhost:${PORT}`;
const DEFAULT_GENESIS_ACCOUNTS = [
  {
    balance: '0x295BE96E64066972000000',
    privateKey:
      '0xa3dac6ca0b1c61f5f0a0b3a0acf93c9a52fd94e8e33d243d3b3a8b8c5dc37f0b', // 0xaaE062157B53077da1414ec3579b4CBdF7a4116f
  },
];

describe('WalletConnectSigner', () => {
  let testnetwork: TestNetwork;
  let walletClient: WalletClient;
  let walletConnectSigner: WalletConnectSigner;

  beforeEach(async () => {
    testnetwork = await TestNetwork.init({
      chainId: CHAIN_ID,
      port: PORT,
      genesisAccounts: DEFAULT_GENESIS_ACCOUNTS,
    });
    walletClient = new WalletClient({
      chainId: CHAIN_ID,
      rpcURL: RPC_URL,
      privateKey: DEFAULT_GENESIS_ACCOUNTS[0].privateKey,
    });
    walletConnectSigner = new WalletConnectSigner({
      chainId: CHAIN_ID,
    }).connect(new ethers.providers.JsonRpcProvider(RPC_URL));
  });

  afterEach(async () => {
    await testnetwork.close();
    await walletClient.close();
  });

  it('should initiate', async () => {
    let uri;
    const connected = walletConnectSigner.uri.then(async (res) => {
      uri = res;
      return await walletClient.pair(uri);
    });
    const accounts = await walletConnectSigner.enable();
    console.log(accounts);
    expect(await connected).toBeTruthy();
    expect(uri).toContain('wc');
    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts[0]).toContain(
      new ethers.Wallet(DEFAULT_GENESIS_ACCOUNTS[0].privateKey).address,
    );
  });

  it('should deploy erc20', async () => {
    let uri;
    const connected = walletConnectSigner.uri.then(async (res) => {
      uri = res;
      return await walletClient.pair(uri);
    });
    const accounts = await walletConnectSigner.enable();
    const erc20Factory = new ERC20Token__factory(walletConnectSigner);
    const erc20 = await erc20Factory.deploy('The test token', 'tst', 18);
    await erc20.deployed();
    const balanceToMint = ethers.utils.parseEther('500');
    console.log(accounts[0]);
    const mintTx = await erc20.mint(accounts[0].split('@')[0], balanceToMint);
    await mintTx.wait();
    const tokenBalance = await erc20.balanceOf(accounts[0].split('@')[0]);
    expect(await connected).toBeTruthy();
    expect(tokenBalance.eq(balanceToMint)).toBeTruthy();
  });
});
