import WalletConnect, { CLIENT_EVENTS } from '@walletconnect/client';
import { ethers } from 'ethers';
import WalletConnectClient from '@walletconnect/client';
import { AppMetadata, SessionTypes } from '@walletconnect/types';

export interface WalletClientOptions {
  privateKey: string;
  chainId: number;
  rpcURL: string;
  relayProvider: string;
  metadata: AppMetadata;
}
export const DEFAULT_WALLET_CLIENT_OPTIONS = {
  privateKey:
    '0xaa3e538de51965294585ec80092ce534d3042c0b8f47e5c17b8c8259ddf6c79c',
  chainId: 1,
  rpcURL: 'http://localhost:8545',
  relayProvider: 'wss://relay.walletconnect.org',
  metadata: {
    name: 'Test wallet',
    description: 'Just a Wallet client for testing',
    icons: ['https://walletconnect.org/walletconnect-logo.png'],
    url: 'https://walletconnect.io',
  },
};

export class WalletClient {
  readonly provider: ethers.providers.JsonRpcProvider;
  readonly signer: ethers.Wallet;
  readonly chainId: number;
  readonly walletConnectClient: Promise<WalletConnect>;
  readonly listener?: Promise<void>;
  readonly options: WalletClientOptions;

  constructor(_options: Partial<WalletClientOptions> = {}) {
    const options: WalletClientOptions = {
      ...DEFAULT_WALLET_CLIENT_OPTIONS,
      ..._options,
    };
    this.options = options;
    const wallet = new ethers.Wallet(options.privateKey);
    this.chainId = options.chainId;
    const rpcURL = options.rpcURL;
    this.provider = new ethers.providers.JsonRpcProvider(rpcURL);
    this.signer = wallet.connect(this.provider);
    this.walletConnectClient = WalletConnectClient.init({
      relayProvider: options.relayProvider,
      controller: true,
      // storageOptions: {
      //   database: "WalletClientDatabase.db",
      //   tableName: "test1",
      // },
      logger: 'warn',
    });
    this.listener = this.listen();
  }

  async pair(uri: string): Promise<string> {
    return new Promise((resolve) => {
      this.walletConnectClient.then(async (wc) => {
        console.log('Start pair');
        const res = await wc.pair({ uri });
        resolve(res);
      });
    });
  }

  private async listen(): Promise<void> {
    return new Promise(() => {
      this.walletConnectClient.then((wc) => {
        console.debug('WalletClient listening');
        wc.on(
          CLIENT_EVENTS.session.proposal,
          async (proposal: SessionTypes.Proposal) => {
            console.log('WalletClient: session.proposal', proposal);
            const response: SessionTypes.Response = {
              state: {
                accounts: [
                  `${this.signer.address + '@eip155:' + this.chainId}`,
                ],
              },
              metadata: this.options.metadata,
            };
            await wc.approve({ proposal, response });
          },
        );
        wc.on(
          CLIENT_EVENTS.session.request,
          async (requestEvent: SessionTypes.RequestEvent) => {
            // user should be prompted to approve the proposed session permissions displaying also dapp metadata
            console.log('WalletClient: session.request', requestEvent);
            const session = wc.session.values.find(
              (session) => session.topic === requestEvent.topic,
            );
            if (!session) {
              throw Error('No active session found for request');
            }
            this.approveRequest(requestEvent);
          },
        );
      });
    });
  }

  approveRequest = async (requestEvent: SessionTypes.RequestEvent) => {
    const wc = await this.walletConnectClient;
    if (!wc) {
      throw new Error('Client is not initialized');
    }
    try {
      if (requestEvent.request.method === 'eth_signTransaction') {
        const populatedTx = await this.signer.populateTransaction(
          requestEvent.request.params[0],
        );
        const parsedTx: ethers.providers.TransactionRequest = {
          ...populatedTx,
          gasLimit: ethers.BigNumber.from(populatedTx.gasLimit).toHexString(),
          gasPrice: ethers.BigNumber.from(populatedTx.gasPrice).toHexString(),
        };
        const signedTransaction = await this.signer.signTransaction(parsedTx);
        await wc.respond({
          topic: requestEvent.topic,
          response: {
            result: signedTransaction,
            id: requestEvent.request.id,
            jsonrpc: requestEvent.request.jsonrpc,
          },
        });
      } else {
        throw Error(
          'WalletClient not implemented method ' + requestEvent.request.method,
        );
      }
    } catch (error) {
      console.error(error);
      await wc.respond({
        topic: requestEvent.topic,
        response: {
          error: {
            code: error.code,
            message: error.message,
          },
          id: requestEvent.request.id,
          jsonrpc: requestEvent.request.jsonrpc,
        },
      });
    }
  };

  async close() {
    delete (this as any).provider;
    delete (this as any).signer;
    delete (this as any).chainId;
    delete (this as any).walletConnectClient;
    delete (this as any).listener;
    delete (this as any).options;
  }
}
