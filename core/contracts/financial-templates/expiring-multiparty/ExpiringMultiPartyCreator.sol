pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../../oracle/implementation/ContractCreator.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/AddressWhitelist.sol";
import "../../common/implementation/Lockable.sol";
import "../common/TokenFactory.sol";
import "../../common/implementation/ExpandedERC20.sol";
import "./ExpiringMultiPartyLib.sol";
import "./PricelessPositionManager.sol";


/**
 * @title Expiring Multi Party Contract creator.
 * @notice Factory contract to create and register new instances of expiring multiparty contracts.
 * Responsible for constraining the parameters used to construct a new Potion. This creator contains a number of constraints
 * that are applied to newly created expiring multi party contract. These constraints can evolve over time and are
 * initially constrained to conservative values in this first iteration. Technically there is nothing in the
 * ExpiringMultiParty contract requiring these constraints. However, because `createExpiringMultiParty()` is intended
 * to be the only way to create valid financial contracts that are registered with the DVM (via _registerContract),
  we can enforce deployment configurations here.
 */
contract ExpiringMultiPartyCreator is ContractCreator, Testable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;

    /****************************************
     *     POTION CREATOR DATA STRUCTURES      *
     ****************************************/

    struct Params {
        uint256 expirationTimestamp;
        address collateralAddress;
        string priceFeedIdentifier;
        string assetClass;
        string syntheticName;
        string syntheticSymbol;
        FixedPoint.Unsigned collateralRequirement;
        FixedPoint.Unsigned disputeBondPct;
        FixedPoint.Unsigned sponsorDisputeRewardPct;
        FixedPoint.Unsigned disputerDisputeRewardPct;
        FixedPoint.Unsigned strikePrice; // Set the strike Price of the put contract.
        FixedPoint.Unsigned assetPrice;
    }
    struct PotionData {
        uint256 expira;
        string assetClass;
        FixedPoint.Unsigned mintedSkPrice;
        FixedPoint.Unsigned mintedAsPrice;
        FixedPoint.Unsigned mintedDep;
    }
    // - Whitelist allowed collateral currencies.
    // Note: before an instantiation of ExpiringMultipartyCreator is approved to register contracts, voters should
    // ensure that the ownership of this collateralTokenWhitelist has been renounced (so it is effectively frozen). One
    // could also set the owner to the address of the Governor contract, but voters may find that option less preferable
    // since it would force them to take a more active role in managing this financial contract template.
    AddressWhitelist public collateralTokenWhitelist;
    // - Address of TokenFactory to pass into newly constructed ExpiringMultiParty contracts
    address public tokenFactoryAddress;

    address[] public contractsAddress;
    // Potion contracts bought by buyer
    mapping(address => address[]) public buyerPotions;
    // Potion revitalisations created by buyer
    mapping(address => address[]) public buyerRevitalPots;
    // Potion assetPrice at minting
    mapping(address => FixedPoint.Unsigned) public mintedPrice;
    // Potion deposit at minting
    mapping(address => FixedPoint.Unsigned) public mintedDeposit;
    // Potion RevitalID
    mapping(address => uint256) public revitalBook;
    // Potion Data
    mapping(address => PotionData) public dataBook;

    // - Discretize expirations such that they must expire on the first of each month.
    mapping(uint256 => bool) public validExpirationTimestamps;
    // - Time for pending withdrawal to be disputed: 120 minutes. Lower liveness increases sponsor usability.
    // However, this parameter is a reflection of how long we expect it to take for liquidators to identify
    // that a sponsor is undercollateralized and acquire the tokens needed to liquidate them. This is also a
    // reflection of how long a malicious sponsor would need to maintain a lower-price manipulation to get
    // their withdrawal processed maliciously (if set too low, it’s quite easy for malicious sponsors to
    // request a withdrawal and spend gas to prevent other transactions from processing until the withdrawal
    //  gets approved). Ultimately, liveness is a friction to be minimized, but not critical to system function.
    uint256 public constant STRICT_WITHDRAWAL_LIVENESS = 1;
    // - Time for liquidation to be disputed: 120 minutes. Similar reasoning to withdrawal liveness.
    // Lower liveness is more usable for liquidators. However, the parameter is a reflection of how
    // long we expect it to take disputers to notice bad liquidations. Malicious liquidators would
    // also need to attack the base chain for this long to prevent dispute transactions from processing.
    uint256 public constant STRICT_LIQUIDATION_LIVENESS = 1;
    IERC20 public collateralCurrency;

    event CreatedPotion(address indexed expiringMultiPartyAddress, address indexed deployerAddress);
    event RevitalisedPotion(uint256 LiquidationID, address indexed deployerAddress);

    /**
     * @notice Constructs the ExpiringMultiPartyCreator contract.
     * @param _finderAddress UMA protocol Finder used to discover other protocol contracts.
     * @param _collateralTokenWhitelist UMA protocol contract to track whitelisted collateral.
     * @param _tokenFactoryAddress ERC20 token factory used to deploy synthetic token instances.
     * @param _timerAddress Contract that stores the current time in a testing environment.
     */
    constructor(
        address _finderAddress,
        address _collateralTokenWhitelist,
        address _tokenFactoryAddress,
        address _timerAddress,
        address _collateralAddress
    ) public ContractCreator(_finderAddress) Testable(_timerAddress) nonReentrant() {
        collateralTokenWhitelist = AddressWhitelist(_collateralTokenWhitelist);
        tokenFactoryAddress = _tokenFactoryAddress;
        collateralCurrency = IERC20(_collateralAddress);
        uint32[16] memory timestamps = [
            1585699200, // 2020-04-01T00:00:00.000Z
            1588291200, // 2020-05-01T00:00:00.000Z
            1590969600, // 2020-06-01T00:00:00.000Z
            1593561600, // 2020-07-01T00:00:00.000Z
            1596240000, // 2020-08-01T00:00:00.000Z
            1598918400, // 2020-09-01T00:00:00.000Z
            1601510400, // 2020-10-01T00:00:00.000Z
            1604188800, // 2020-11-01T00:00:00.000Z
            1606780800, // 2020-12-01T00:00:00.000Z
            1609459200, // 2021-01-01T00:00:00.000Z
            1612137600, // 2021-02-01T00:00:00.000Z
            1614556800, // 2021-03-01T00:00:00.000Z
            1617235200, // 2021-04-01T00:00:00.000Z
            1619827200, // 2021-05-01T00:00:00.000Z
            1622505600, // 2021-06-01T00:00:00.000Z
            1625097600 // 2021-07-01T00:00:00.000Z
        ];
        for (uint256 i = 0; i < timestamps.length; i++) {
            validExpirationTimestamps[timestamps[i]] = true;
        }
    }

    function writeMintPotion(
        Params memory params,
        address poolAddress,
        FixedPoint.Unsigned memory nTokens,
        FixedPoint.Unsigned memory deposit
    ) public nonReentrant() {
        address derivative = ExpiringMultiPartyLib.deploy(_convertParams(params));
        ExpiringMultiParty potion = ExpiringMultiParty(address(derivative));
        FixedPoint.Unsigned memory collateral = nTokens.mul(params.strikePrice);
        FixedPoint.Unsigned memory totalDeposit = nTokens.mul(deposit);
        collateralCurrency.safeTransferFrom(poolAddress, address(this), collateral.rawValue);
        collateralCurrency.safeTransferFrom(msg.sender, address(this), totalDeposit.rawValue);
        collateralCurrency.approve(address(derivative), totalDeposit.add(collateral).rawValue);
        potion.create(poolAddress, msg.sender, address(this), nTokens, totalDeposit, collateral);

        // Keep track of all created contract addresses
        _registerContract(new address[](0), address(derivative));
        emit CreatedPotion(address(derivative), msg.sender);
        contractsAddress.push(address(derivative));
        buyerPotions[msg.sender].push(address(derivative));
        dataBook[address(derivative)] = PotionData({
            expira: params.expirationTimestamp,
            assetClass: params.assetClass,
            mintedSkPrice: params.strikePrice,
            mintedAsPrice: params.assetPrice,
            mintedDep: deposit
        });
        mintedPrice[address(derivative)] = params.assetPrice;
        mintedDeposit[address(derivative)] = deposit;
    }

    function revitalisePotion(
        address potionAddress,
        address poolAddress,
        FixedPoint.Unsigned memory nTokens,
        FixedPoint.Unsigned memory assetPrice,
        FixedPoint.Unsigned memory dvmBond,
        FixedPoint.Unsigned memory finalDeposit
    ) public nonReentrant() {
        ExpiringMultiParty potion = ExpiringMultiParty(potionAddress);
        IERC20 potionCurrency = potion.tokenCurrency();
        collateralCurrency.approve(potionAddress, dvmBond.rawValue);
        require(mintedDeposit[potionAddress].isGreaterThanOrEqual(finalDeposit));
        FixedPoint.Unsigned memory excessDeposit = nTokens.mul(mintedDeposit[potionAddress].sub(finalDeposit));
        collateralCurrency.safeTransferFrom(msg.sender, address(this), dvmBond.rawValue);
        potionCurrency.approve(potionAddress, nTokens.rawValue);
        potionCurrency.safeTransferFrom(msg.sender, address(this), nTokens.rawValue);
        uint256 revitalID = potion.createLiquidation(
            poolAddress,
            msg.sender,
            address(this),
            nTokens,
            assetPrice,
            dvmBond,
            excessDeposit
        );
        // Keep track of all created revitalisations
        emit RevitalisedPotion(revitalID, msg.sender);
        revitalBook[potionAddress] = revitalID;
        buyerRevitalPots[msg.sender].push(potionAddress);
    }

    function withdrawPotion(
        uint256 revitalID,
        address potionAddress,
        address poolAddress
    ) public nonReentrant() {
        ExpiringMultiParty potion = ExpiringMultiParty(potionAddress);
        potion.withdrawLiquidation(revitalID, poolAddress, msg.sender);
    }

    /****************************************
     *          FRONTEND DATA FUNCTIONS           *
     ****************************************/
    function getPotionData(address potionAddrs)
        external
        view
        returns (
            uint256 expiry,
            string memory asset,
            FixedPoint.Unsigned memory mintSprice,
            FixedPoint.Unsigned memory mintAprice,
            FixedPoint.Unsigned memory mintDepo
        )
    {
        PotionData storage potionData = dataBook[potionAddrs];
        return (
            potionData.expira,
            potionData.assetClass,
            potionData.mintedSkPrice,
            potionData.mintedAsPrice,
            potionData.mintedDep
        );
    }

    /****************************************
     *          FACTORY DATA FUNCTIONS           *
     ****************************************/
    function getContractAddressList() public view returns (address[] memory list) {
        return contractsAddress;
    }

    /****************************************
     *          BUYER DATA FUNCTIONS           *
     ****************************************/
    function getBuyerPotions(address buyer) external view returns (address[] memory list) {
        return buyerPotions[buyer];
    }

    function getBuyerRevitalPots(address buyer) external view returns (address[] memory list) {
        return buyerRevitalPots[buyer];
    }

    /****************************************
     *          REVITAL DATA FUNCTIONS           *
     ****************************************/
    function getRevitalID(address potionAddress) external view returns (uint256 price) {
        return revitalBook[potionAddress];
    }

    /****************************************
     *          PRIVATE FUNCTIONS           *
     ****************************************/

    //  Returns if expiration timestamp is on hardcoded list.
    function _isValidTimestamp(uint256 timestamp) private view returns (bool) {
        return validExpirationTimestamps[timestamp];
    }

    function _stringToBytes32(string memory source) private pure returns (bytes32 result) {
        bytes memory tempEmptyStringTest = bytes(source);
        if (tempEmptyStringTest.length == 0) {
            return 0x0;
        }
        assembly {
            result := mload(add(source, 32))
        }
    }

    // Converts createExpiringMultiParty params to ExpiringMultiParty constructor params.
    function _convertParams(Params memory params)
        private
        view
        returns (ExpiringMultiParty.ConstructorParams memory constructorParams)
    {
        // Known from creator deployment.
        constructorParams.finderAddress = finderAddress;
        constructorParams.tokenFactoryAddress = tokenFactoryAddress;
        constructorParams.timerAddress = timerAddress;

        // Enforce configuration constraints.
        require(_isValidTimestamp(params.expirationTimestamp), "Invalid expiration timestamp");
        require(bytes(params.syntheticName).length != 0, "Missing synthetic name");
        require(bytes(params.syntheticSymbol).length != 0, "Missing synthetic symbol");
        constructorParams.withdrawalLiveness = STRICT_WITHDRAWAL_LIVENESS;
        constructorParams.liquidationLiveness = STRICT_LIQUIDATION_LIVENESS;
        require(collateralTokenWhitelist.isOnWhitelist(params.collateralAddress), "Collateral is not whitelisted");

        // Input from function call.
        constructorParams.expirationTimestamp = params.expirationTimestamp;
        constructorParams.deploymentTimestamp = getCurrentTime();
        constructorParams.collateralAddress = params.collateralAddress;
        constructorParams.priceFeedIdentifier = _stringToBytes32(params.priceFeedIdentifier);
        constructorParams.syntheticName = params.syntheticName;
        constructorParams.syntheticSymbol = params.syntheticSymbol;
        constructorParams.collateralRequirement = params.collateralRequirement;
        constructorParams.disputeBondPct = params.disputeBondPct;
        constructorParams.sponsorDisputeRewardPct = params.sponsorDisputeRewardPct;
        constructorParams.disputerDisputeRewardPct = params.disputerDisputeRewardPct;
        constructorParams.strikePrice = params.strikePrice;
    }
}
