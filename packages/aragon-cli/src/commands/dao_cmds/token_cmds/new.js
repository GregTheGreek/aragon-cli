const TaskList = require('listr')
const { ensureWeb3 } = require('../../../helpers/web3-fallback')
const { getContract } = require('../../../util')
const listrOpts = require('../../../helpers/listr-options')
const chalk = require('chalk')
const web3Utils = require('web3-utils')
const {
  getRecommendedGasLimit,
  parseStringIfPossible,
  ZERO_ADDRESS,
} = require('../../../util')

const MAINNET_MINIME_TOKEN_FACTORY =
  '0x909d05f384d0663ed4be59863815ab43b4f347ec'
const RINKEBY_MINIME_TOKEN_FACTORY =
  '0xad991658443c56b3dE2D7d7f5d8C68F339aEef29'

exports.command =
  'new <token-name> <symbol> [decimal-units] [transfer-enabled] [token-factory-address]'

exports.describe = 'Create a new MiniMe token'

exports.builder = yargs => {
  return yargs
    .positional('token-name', {
      description: 'Full name of the new Token',
    })
    .positional('symbol', {
      description: 'Symbol of the new Token',
    })
    .option('decimal-units', {
      description: 'Total decimal units the new token will use',
      default: 18,
    })
    .option('transfer-enabled', {
      description: 'Whether the new token will have transfers enabled',
      default: true,
    })
    .option('token-factory-address', {
      description: 'Address of the MiniMeTokenFactory',
      type: 'string',
    })
}

exports.task = async ({
  web3,
  tokenName,
  symbol,
  transferEnabled,
  decimalUnits,
  tokenFactoryAddress,
  silent,
  debug,
}) => {
  // Decode sender
  const accounts = await web3.eth.getAccounts()
  const from = accounts[0]

  // Get chain id
  const chainId = await web3.eth.net.getId()

  if (chainId === 1)
    tokenFactoryAddress = tokenFactoryAddress || MAINNET_MINIME_TOKEN_FACTORY

  if (chainId === 4)
    tokenFactoryAddress = tokenFactoryAddress || RINKEBY_MINIME_TOKEN_FACTORY

  transferEnabled = parseStringIfPossible(transferEnabled)

  return new TaskList(
    [
      {
        title: 'Deploy the MiniMeTokenFactory contract',
        enabled: () => !web3Utils.isAddress(tokenFactoryAddress),
        task: async (ctx, task) => {
          let artifact = getContract(
            '@aragon/apps-shared-minime',
            'MiniMeTokenFactory'
          )
          let contract = new web3.eth.Contract(artifact.abi)

          const deployTx = contract.deploy({ data: artifact.bytecode })
          const estimatedGas = await deployTx.estimateGas()

          const deployPromise = deployTx.send({
            from,
            gas: await getRecommendedGasLimit(web3, estimatedGas),
          })

          deployPromise
            .on('receipt', function(receipt) {
              ctx.factoryAddress = receipt.contractAddress
            })
            .on('transactionHash', transactionHash => {
              ctx.factoryTxHash = transactionHash
            })
            .on('error', function(error) {
              throw error
            })

          task.output = `Waiting for the transaction to be mined...`
          return deployPromise
        },
      },
      {
        title: 'Deploy the MiniMeToken contract',
        task: async (ctx, task) => {
          let artifact = getContract(
            '@aragon/apps-shared-minime',
            'MiniMeToken'
          )
          let contract = new web3.eth.Contract(artifact.abi)

          const deployTx = contract.deploy({
            data: artifact.bytecode,
            arguments: [
              ctx.factoryAddress || tokenFactoryAddress,
              ZERO_ADDRESS,
              0,
              tokenName,
              decimalUnits,
              symbol,
              transferEnabled,
            ],
          })
          const estimatedGas = await deployTx.estimateGas()

          const deployPromise = deployTx.send({
            from,
            gas: await getRecommendedGasLimit(web3, estimatedGas),
          })

          deployPromise
            .on('receipt', function(receipt) {
              ctx.tokenAddress = receipt.contractAddress
            })
            .on('transactionHash', transactionHash => {
              ctx.tokenTxHash = transactionHash
            })
            .on('error', function(error) {
              throw error
            })

          task.output = `Waiting for the transaction to be mined...`
          return deployPromise
        },
      },
    ],
    listrOpts(silent, debug)
  )
}

exports.handler = async function({
  reporter,
  network,
  tokenName,
  symbol,
  transferEnabled,
  decimalUnits,
  tokenFactoryAddress,
  silent,
  debug,
}) {
  const web3 = await ensureWeb3(network)

  const task = await exports.task({
    web3,
    tokenName,
    symbol,
    transferEnabled,
    decimalUnits,
    tokenFactoryAddress,
    silent,
    debug,
  })
  return task.run().then(ctx => {
    reporter.success(
      `Successfully deployed the token at ${chalk.bold(ctx.tokenAddress)}`
    )
    reporter.info(`Token transaction hash: ${ctx.tokenTxHash}`)

    if (ctx.factoryAddress) {
      reporter.success(
        `Successfully deployed the token factory at ${chalk.bold(
          ctx.factoryAddress
        )}`
      )
      reporter.info(`Token factory transaction hash: ${ctx.factoryTxHash}`)
    }

    process.exit()
  })
}
