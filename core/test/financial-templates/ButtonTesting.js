const { toWei, fromWei, hexToUtf8, toBN, utf8ToHex } = web3.utils;
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");
const { RegistryRolesEnum } = require("../../../common/Enums.js");
const { LiquidationStatesEnum } = require("../../../common/Enums");
const { interfaceName } = require("../../utils/Constants.js");
const { MAX_UINT_VAL } = require("../../../common/Constants.js");
const { PositionStatesEnum } = require("../../../common/Enums");
const unreachableDeadline = MAX_UINT_VAL;

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
    await registry.addMember(1, expiringMultiPartyCreator.address, { from: contractCreator });
    // Whitelist collateral currency
    collateralTokenWhitelist = await AddressWhitelist.at(await expiringMultiPartyCreator.collateralTokenWhitelist());
    await collateralTokenWhitelist.addToWhitelist(TestnetERC20.address, { from: contractCreator });
  });

  it("Button 2 Should deploy contracts with different parameters", async function() {
    constructorParams = {
      // expirationTimestamp: (Math.round(Date.now() / 1000) + 1000).toString(),
      expirationTimestamp: "1590969600", // 1st June 2020
      withdrawalLiveness: "1",
      collateralAddress: TestnetERC20.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: utf8ToHex("UMATEST"),
      syntheticName: "Potion Token ETH June",
      syntheticSymbol: "POTETH_JUNE",
      liquidationLiveness: "1",
      collateralRequirement: { rawValue: toWei("1.0") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      strikePrice: { rawValue: toWei("100") },
      timerAddress: Timer.address
    };
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, { from: contractCreator });
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
      strikePrice: { rawValue: toWei("50") },
      timerAddress: Timer.address
    };
    tx2 = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, { from: contractCreator });
    const e2 = await ExpiringMultiParty.at(tx2.logs[0].args.expiringMultiPartyAddress);
    console.log(await expiringMultiPartyCreator.getContractAddressList());
  });

  it("Button 2 Should mint from existing contracts", async function() {
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
      strikePrice: { rawValue: toWei("100") },
      timerAddress: Timer.address
    };
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, { from: contractCreator });
    tx = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, { from: contractCreator });
    const e = await ExpiringMultiParty.at(tx.logs[0].args.expiringMultiPartyAddress);

    const collateralToken = await TestnetERC20.deployed();
    const syntheticToken = await SyntheticToken.at(await e.tokenCurrency());

    await collateralToken.allocateTo(contractCreator, toWei("100000000000"));
    await collateralToken.allocateTo(putBuyer, toWei("5000000"));
    await collateralToken.approve(e.address, toWei("100000000000"), { from: contractCreator });
    console.log(
      "Initial Collateral Balance in LP Pool:",
      fromWei((await collateralToken.balanceOf(contractCreator)).toString())
    );
    console.log("Buyer's Initial Collateral Balance:", fromWei((await syntheticToken.balanceOf(putBuyer)).toString()));
    console.log("Buyer's Initial Potion Balance:", fromWei((await collateralToken.balanceOf(putBuyer)).toString()));
    await collateralToken.approve(e.address, toWei("5000000"), { from: putBuyer });

    await e.create(contractCreator, { rawValue: toWei("700") }, { rawValue: toWei("10") }, { from: putBuyer });
    console.log(
      "Buyer's Potion Balance after position creation:",
      fromWei((await syntheticToken.balanceOf(putBuyer)).toString())
    );
    console.log(
      "Buyer's Collateral Balance after position creation:",
      fromWei((await collateralToken.balanceOf(putBuyer)).toString())
    );
    console.log(
      "LP Pool Balance after position creation:",
      fromWei((await collateralToken.balanceOf(contractCreator)).toString())
    );
  });

  it("Button 3 Should create liquidation/exercising orders", async function() {
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
    const syntheticToken = await SyntheticToken.at(await e.tokenCurrency());

    // await collateralToken.allocateTo(contractCreator, toWei("100000000000"));
    // await collateralToken.allocateTo(putBuyer, toWei("5000000"));
    await collateralToken.approve(e.address, toWei("100000000000"), { from: contractCreator });
    await collateralToken.approve(e.address, toWei("5000000"), { from: putBuyer });

    await e.create(contractCreator, { rawValue: toWei("700") }, { rawValue: toWei("10") }, { from: putBuyer });

    await syntheticToken.approve(e.address, toWei("700"), { from: putBuyer });
    await e.createLiquidation(
      contractCreator,
      { rawValue: toWei("100") },
      { rawValue: toWei("50") },
      { from: putBuyer }
    );
    console.log(
      "Buyer's Potion Balance after requesting 100token liquidation at price 50:",
      fromWei((await syntheticToken.balanceOf(putBuyer)).toString())
    );
    console.log(
      "Buyer's Collateral Balance after requesting 100token liquidation at price 50:",
      fromWei((await collateralToken.balanceOf(putBuyer)).toString())
    );
  });

  it("Button 4 Should withdraw liquidation/exercising orders", async function() {
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
    const syntheticToken = await SyntheticToken.at(await e.tokenCurrency());

    // await collateralToken.allocateTo(contractCreator, toWei("100000000000"));
    // await collateralToken.allocateTo(putBuyer, toWei("5000000"));
    await collateralToken.approve(e.address, toWei("100000000000"), { from: contractCreator });
    await collateralToken.approve(e.address, toWei("5000000"), { from: putBuyer });

    await e.create(contractCreator, { rawValue: toWei("700") }, { rawValue: toWei("10") }, { from: putBuyer });

    await syntheticToken.approve(e.address, toWei("700"), { from: putBuyer });
    const { liquidationId } = await e.createLiquidation.call(
      contractCreator,
      { rawValue: toWei("100") },
      { rawValue: toWei("50") },
      unreachableDeadline,
      { from: putBuyer }
    );
    await e.createLiquidation(
      contractCreator,
      { rawValue: toWei("100") },
      { rawValue: toWei("50") },
      { from: putBuyer }
    );

    const timer = await Timer.deployed();
    await timer.setCurrentTime((await timer.getCurrentTime()).toNumber() + 7201);
    console.log("Liquidation ID", liquidationId.toString());

    console.log(
      "LP's Collateral Balance before withdrawal of 100token liquidation at price 50:",
      fromWei((await collateralToken.balanceOf(contractCreator)).toString())
    );

    await e.withdrawLiquidation(liquidationId, contractCreator, { from: putBuyer });
    console.log(
      "Buyer's Collateral Balance after withdrawing 100token liquidation at price 50:",
      fromWei((await collateralToken.balanceOf(putBuyer)).toString())
    );

    console.log(
      "Contracts's Collateral Balance after buyer withdrawed 100token liquidation at price 50:",
      fromWei((await collateralToken.balanceOf(e.address)).toString())
    );
    await e.withdrawLiquidation(liquidationId, contractCreator, { from: contractCreator });
    console.log(
      "LP's Collateral Balance after withdrawal of 100token liquidation at price 50:",
      fromWei((await collateralToken.balanceOf(contractCreator)).toString())
    );
  });

  it("Button 4 Should allow consecutive exercisings/withdrawals ", async function() {
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
    const syntheticToken = await SyntheticToken.at(await e.tokenCurrency());

    // await collateralToken.allocateTo(contractCreator, toWei("100000000000"));
    // await collateralToken.allocateTo(putBuyer, toWei("5000000"));
    await collateralToken.approve(e.address, toWei("100000000000"), { from: contractCreator });
    await collateralToken.approve(e.address, toWei("5000000"), { from: putBuyer });

    await e.create(contractCreator, { rawValue: toWei("700") }, { rawValue: toWei("10") }, { from: putBuyer });

    await syntheticToken.approve(e.address, toWei("700"), { from: putBuyer });

    liq1 = await e.createLiquidation(
      contractCreator,
      { rawValue: toWei("100") },
      { rawValue: toWei("50") },
      unreachableDeadline,
      { from: putBuyer }
    );
    liquidationId = liq1.logs[0].args.liquidationId;
    const timer = await Timer.deployed();
    await timer.setCurrentTime((await timer.getCurrentTime()).toNumber() + 7201);
    await e.withdrawLiquidation(liquidationId, contractCreator, { from: putBuyer });
    await e.withdrawLiquidation(liquidationId, contractCreator, { from: contractCreator });
    console.log("Liquidation ID 1", liquidationId.toString());

    liq2 = await e.createLiquidation(
      contractCreator,
      { rawValue: toWei("200") },
      { rawValue: toWei("80") },
      unreachableDeadline,
      { from: putBuyer }
    );
    liquidationId2 = liq2.logs[0].args.liquidationId;
    await timer.setCurrentTime((await timer.getCurrentTime()).toNumber() + 7201);
    await e.withdrawLiquidation(liquidationId2, contractCreator, { from: putBuyer });
    await e.withdrawLiquidation(liquidationId2, contractCreator, { from: contractCreator });
    console.log("Liquidation ID 2", liq2.logs[0].args.liquidationId.toString());

    console.log(
      "Buyer's Collateral Balance after withdrawing 100token liquidation at price 50 followed by 200token at price 80:",
      fromWei((await collateralToken.balanceOf(putBuyer)).toString())
    );
  });
});
