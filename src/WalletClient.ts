/* eslint-disable @typescript-eslint/no-unused-vars */
import { Client, CLIENT_EVENTS } from '@walletconnect/client';
import { ClientOptions, IClient, PairingTypes, SessionTypes, ClientTypes } from '@walletconnect/types';
import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import debug from 'debug';

function isClient(opts?: IClient | ClientOptions): opts is IClient {
  return typeof opts !== 'undefined' && typeof (opts as IClient).context !== 'undefined';
}
export interface WalletClientOpts {
  privateKey: string;
  rpcURL: string;
  walletConnectOpts: ClientOptions;
  debug: boolean;
}
export const DEFAULT: WalletClientOpts = {
  privateKey: '0xaa3e538de51965294585ec80092ce534d3042c0b8f47e5c17b8c8259ddf6c79c',
  rpcURL: 'http://localhost:8545',
  walletConnectOpts: {
    metadata: {
      name: 'Test wallet',
      description: 'Just a Wallet client for testing',
      icons: ['https://walletconnect.org/walletconnect-logo.png'],
      url: 'https://walletconnect.io',
    },
    controller: true,
    relayProvider: 'wss://relay.walletconnect.org',
    name: 'WalletClient',
  },
  debug: false,
};

export const WALLET_EVENTS = {
  init: 'wallet_init',
  pair: 'wallet_pair',
};

export class WalletClient {
  provider: ethers.providers.Provider;
  events = new EventEmitter();
  client?: IClient;
  initializing = false;
  opts: WalletClientOpts;
  signer: ethers.Wallet;
  private log: debug.Debugger;

  constructor(_opts: Partial<WalletClientOpts> = {}) {
    const _clientOptions: ClientOptions = {
      ...DEFAULT.walletConnectOpts,
      ..._opts.walletConnectOpts,
    };
    this.opts = {
      ...DEFAULT,
      ..._opts,
      ...{ walletConnectOpts: _clientOptions },
    };
    this.log = debug('WalletClient');
    this.log.enabled = this.opts.debug ? true : false;
    const wallet = new ethers.Wallet(this.opts.privateKey);
    this.provider = new ethers.providers.JsonRpcProvider(this.opts.rpcURL);
    this.signer = wallet.connect(this.provider);
    this.register(this.opts.walletConnectOpts);
  }

  // PUBLIC

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public waitFor(event: string): Promise<any> {
    return new Promise((resolve) => {
      this.events.on(event, (event) => {
        resolve(event);
      });
    });
  }

  public async pair(uri: string) {
    this.log('got pair request');
    this.log(uri);
    if (typeof this.client === 'undefined') {
      this.client = await this.register();
    }
    return this.client.pair({ uri });
  }

  public async close() {
    await this.register();
    this.onClose();
  }

  approveRequest = async (requestEvent: SessionTypes.RequestEvent) => {
    if (typeof this.client === 'undefined') {
      this.client = await this.register();
    }
    try {
      if (requestEvent.request.method === 'eth_signTransaction') {
        const populatedTx = await this.signer.populateTransaction(requestEvent.request.params[0]);
        const parsedTx: ethers.providers.TransactionRequest = {
          ...populatedTx,
          gasLimit: ethers.BigNumber.from(populatedTx.gasLimit).toHexString(),
          gasPrice: ethers.BigNumber.from(populatedTx.gasPrice).toHexString(),
        };
        const signedTransaction = await this.signer.signTransaction(parsedTx);
        return this.client.respond({
          topic: requestEvent.topic,
          response: {
            result: signedTransaction,
            id: requestEvent.request.id,
            jsonrpc: requestEvent.request.jsonrpc,
          },
        });
      }
      if (requestEvent.request.method === 'oracle_data') {
        return await this.client.respond({
          topic: requestEvent.topic,
          response: {
            result: 'success' + requestEvent.request.params[0],
            id: requestEvent.request.id,
            jsonrpc: requestEvent.request.jsonrpc,
          },
        });
      }
      throw Error('WalletClient not implemented method ' + requestEvent.request.method);
    } catch (error) {
      this.log(error);
      await this.client.respond({
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

  // PRIVATE

  private onClose() {
    if (this.client) {
      this.client = undefined;
    }
    this.events.emit('close');
  }

  private async register(opts?: IClient | ClientOptions): Promise<IClient> {
    if (typeof this.client !== 'undefined') {
      return this.client;
    }
    if (this.initializing) {
      return new Promise((resolve, reject) => {
        this.events.once(WALLET_EVENTS.init, () => {
          if (typeof this.client === 'undefined') {
            return reject(new Error('Client not initialized'));
          }
          resolve(this.client);
        });
      });
    }
    if (isClient(opts)) {
      this.client = opts;
      this.registerEventListeners();
      return this.client;
    }
    this.initializing = true;
    this.client = await Client.init(opts);
    this.initializing = false;
    this.registerEventListeners();
    this.events.emit(WALLET_EVENTS.init);
    return this.client;
  }

  private registerEventListeners() {
    if (typeof this.client === 'undefined') return;
    this.log('Wallet listening');
    // Sessions
    this.client.on(CLIENT_EVENTS.session.updated, (_session: SessionTypes.Settled) => {
      this.log('WALLET_EVENTS.session.updated');
    });
    this.client.on(CLIENT_EVENTS.session.created, (_session: SessionTypes.Settled) => {
      this.log('WALLET_EVENTS.session.created');
    });
    this.client.on(CLIENT_EVENTS.session.deleted, (_session: SessionTypes.Settled) => {
      this.log('WALLET_EVENTS.session.deleted');
    });
    this.client.on(CLIENT_EVENTS.session.request, async (requestEvent: SessionTypes.RequestEvent) => {
      this.log('WalletClient: session.request', requestEvent);
      const session = this.client.session.values.find((session) => session.topic === requestEvent.topic);
      if (!session) {
        throw Error('No active session found for request');
      }
      await this.approveRequest(requestEvent);
    });
    this.client.on(CLIENT_EVENTS.session.proposal, async (proposal: SessionTypes.Proposal) => {
      this.log('WALLET_EVENTS.pairing.proposal');
      const metadata = this.opts.walletConnectOpts.metadata;
      const network = await this.provider.getNetwork();
      const response: ClientTypes.ResponseInput = {
        state: {
          accounts: [
            // AccountId.format({
            //   chainId: { reference: network.chainId.toString(), namespace: 'eip155' },
            //   address: this.signer.address,
            // }),
            `eip155:${network.chainId.toString()}:${this.signer.address}`,
          ],
        },
        metadata,
      };
      this.log(response);
      await this.client.approve({ proposal, response });
    });
    // Pairing
    this.client.on(CLIENT_EVENTS.pairing.updated, (_pairing: PairingTypes.Settled) => {
      this.log('WALLET_EVENTS.pairing.updated');
    });
    this.client.on(CLIENT_EVENTS.pairing.created, (_pairing: PairingTypes.Settled) => {
      this.log('WALLET_EVENTS.pairing.created');
    });
    this.client.on(CLIENT_EVENTS.pairing.deleted, (_pairing: PairingTypes.Settled) => {
      this.log('WALLET_EVENTS.pairing.deleted');
    });
  }
}
