// Helper scripts
const { toWei, fromWei, hexToUtf8, toBN, utf8ToHex } = web3.utils;
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");
const { RegistryRolesEnum } = require("../../../common/Enums.js");
const { LiquidationStatesEnum } = require("../../../common/Enums");
const { interfaceName } = require("../../utils/Constants.js");
const { MAX_UINT_VAL } = require("../../../common/Constants.js");
const { PositionStatesEnum } = require("../../../common/Enums");

// Helper Contracts
const Token = artifacts.require("ExpandedERC20");
const TestnetERC20 = artifacts.require("TestnetERC20");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const Timer = artifacts.require("Timer");
const Registry = artifacts.require("Registry");
const SyntheticToken = artifacts.require("SyntheticToken");

// Tested Contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const PricelessPositionManager = artifacts.require("PricelessPositionManager");
const Liquidatable = artifacts.require("Liquidatable");

contract("ExpiringMultiPartyCreator", function(accounts) {
  let contractCreator = accounts[0];
  let putBuyer = accounts[1];
  let collateralToken;
  let expiringMultiPartyCreator;
  let registry;
  let collateralTokenWhitelist;
  let constructorParams;

  beforeEach(async () => {
    registry = await Registry.deployed();
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address, {
      from: contractCreator
    });
    // Whitelist collateral currency
    collateralTokenWhitelist = await AddressWhitelist.at(await expiringMultiPartyCreator.collateralTokenWhitelist());
    await collateralTokenWhitelist.addToWhitelist(TestnetERC20.address, { from: contractCreator });
  });

  it("Should deploy contracts with different parameters", async function() {
    constructorParams = {
      // expirationTimestamp: (Math.round(Date.now() / 1000) + 1000).toString(),
      expirationTimestamp: "1590969600", // 1st June 2020
      withdrawalLiveness: "1000",
      collateralAddress: TestnetERC20.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: utf8ToHex("UMATEST"),
      syntheticName: "Potion Token ETH June",
      syntheticSymbol: "POTETH_JUNE",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.0") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      strikePrice: { rawValue: toWei("100") },
      timerAddress: Timer.address
    };
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: contractCreator
    });
    tx1 = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, { from: contractCreator });
    const e1 = await ExpiringMultiParty.at(tx1.logs[0].args.expiringMultiPartyAddress);

    constructorParams = {
      // expirationTimestamp: (Math.round(Date.now() / 1000) + 1000).toString(),
      expirationTimestamp: "1590969600",
      withdrawalLiveness: "1000",
      collateralAddress: TestnetERC20.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: utf8ToHex("UMATEST"),
      syntheticName: "Potion Token Gold June",
      syntheticSymbol: "POTGOLD_JUNE",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.0") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      strikePrice: { rawValue: toWei("50") },
      timerAddress: Timer.address
    };
    tx2 = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, { from: contractCreator });
    const e2 = await ExpiringMultiParty.at(tx2.logs[0].args.expiringMultiPartyAddress);
    console.log(await expiringMultiPartyCreator.getContractAddressList());
  });

  it("Should mint from existing contracts", async function() {
    constructorParams = {
      // expirationTimestamp: (Math.round(Date.now() / 1000) + 1000).toString(),
      expirationTimestamp: "1590969600", // 1st June 2020
      withdrawalLiveness: "1000",
      collateralAddress: TestnetERC20.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: utf8ToHex("UMATEST"),
      syntheticName: "Potion Token ETH June",
      syntheticSymbol: "POTETH_JUNE",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.0") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      strikePrice: { rawValue: toWei("100") },
      timerAddress: Timer.address
    };
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: contractCreator
    });
    tx = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, { from: contractCreator });
    const e = await ExpiringMultiParty.at(tx.logs[0].args.expiringMultiPartyAddress);

    const collateralToken = await TestnetERC20.deployed();
    await collateralToken.allocateTo(contractCreator, toWei("100000000000"));
    await collateralToken.allocateTo(putBuyer, toWei("5000000"));
    await collateralToken.approve(e.address, toWei("100000000000"), { from: contractCreator });
    await collateralToken.approve(e.address, toWei("5000000"), { from: putBuyer });
    await e.create(contractCreator, { rawValue: toWei("700") }, { rawValue: toWei("10") }, { from: putBuyer });

    const syntheticToken = await SyntheticToken.at(await e.tokenCurrency());
    console.log((await syntheticToken.balanceOf(putBuyer)).toString());
  });
});
