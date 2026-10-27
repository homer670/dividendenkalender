package oracle;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import name.abuchen.portfolio.math.Risk.Drawdown;
import name.abuchen.portfolio.math.Risk.Volatility;
import name.abuchen.portfolio.model.Client;
import name.abuchen.portfolio.model.Taxonomy;
import name.abuchen.portfolio.money.CurrencyConverter;
import name.abuchen.portfolio.money.CurrencyConverterImpl;
import name.abuchen.portfolio.money.ExchangeRateProviderFactory;
import name.abuchen.portfolio.snapshot.AccountSnapshot;
import name.abuchen.portfolio.snapshot.AssetCategory;
import name.abuchen.portfolio.snapshot.AssetPosition;
import name.abuchen.portfolio.snapshot.ClientSnapshot;
import name.abuchen.portfolio.snapshot.GroupByTaxonomy;
import name.abuchen.portfolio.snapshot.PerformanceIndex;
import name.abuchen.portfolio.snapshot.PortfolioSnapshot;
import name.abuchen.portfolio.snapshot.ReportingPeriod;
import name.abuchen.portfolio.snapshot.SecurityPosition;
import name.abuchen.portfolio.util.Interval;

public class CalcDump
{
    public static final LocalDate[] SNAPSHOT_DATES = { LocalDate.of(2018, 1, 1), LocalDate.of(2018, 6, 30),
                    LocalDate.of(2019, 12, 31), LocalDate.of(2021, 3, 15), LocalDate.of(2022, 2, 2),
                    LocalDate.of(2023, 7, 1), LocalDate.of(2024, 12, 31), LocalDate.of(2025, 6, 30),
                    LocalDate.of(2026, 1, 1) };

    public static final String[] PERIODS = { "L1Y0", "L3Y0", "L0Y6", "Y2019", "Y2020", "Y2021", "Y2022", "Y2023",
                    "Y2024", "S2017-12-01", "F2019-03-01_2020-03-01", "F2024-06-01_2026-01-01", "D30", "T20", "Z",
                    "B", "C", "A", "P", "E", "Q", "W", "L2Y3" };

    public static final LocalDate RELATIVE_TO = LocalDate.of(2025, 6, 30);

    static long[] copy(long[] a)
    {
        return a.clone();
    }

    static Map<String, Object> interval(Interval i)
    {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("start", i.getStart().toString());
        m.put("end", i.getEnd().toString());
        return m;
    }

    public static Map<String, Object> dump(Client client, String spec)
    {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("today", LocalDate.now().toString());
        CurrencyConverter converter = new CurrencyConverterImpl(new ExchangeRateProviderFactory(client),
                        client.getBaseCurrency());

        // snapshots
        List<Object> snapshots = new ArrayList<>();
        for (LocalDate date : SNAPSHOT_DATES)
        {
            ClientSnapshot snapshot = ClientSnapshot.create(client, converter, date);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("date", date.toString());
            m.put("assets", snapshot.getMonetaryAssets().getAmount());
            List<Object> accounts = new ArrayList<>();
            for (AccountSnapshot a : snapshot.getAccounts())
                accounts.add(a.getAccount().getUUID() + ":" + a.getFunds().getAmount() + ":"
                                + a.getUnconvertedFunds().getAmount());
            m.put("accounts", accounts);
            List<Object> portfolios = new ArrayList<>();
            for (PortfolioSnapshot p : snapshot.getPortfolios())
            {
                Map<String, Object> pm = new LinkedHashMap<>();
                pm.put("uuid", p.getPortfolio().getUUID());
                pm.put("value", p.getValue().getAmount());
                Map<String, Object> positions = new java.util.TreeMap<>();
                for (SecurityPosition pos : p.getPositions())
                    positions.put(pos.getSecurity().getUUID(), pos.getShares() + ":" + pos.getPrice().getDate() + "="
                                    + pos.getPrice().getValue() + ":" + pos.calculateValue().getAmount());
                pm.put("positions", positions);
                portfolios.add(pm);
            }
            m.put("portfolios", portfolios);
            Map<String, Object> joint = new java.util.TreeMap<>();
            for (SecurityPosition pos : snapshot.getJointPortfolio().getPositions())
                joint.put(pos.getSecurity().getUUID(), pos.getShares() + ":" + pos.calculateValue().getAmount());
            m.put("joint", joint);
            m.put("jointValue", snapshot.getJointPortfolio().getValue().getAmount());

            List<Object> taxonomies = new ArrayList<>();
            List<Taxonomy> taxonomyList = new ArrayList<>(client.getTaxonomies());
            taxonomyList.add(null);
            for (Taxonomy t : taxonomyList)
            {
                GroupByTaxonomy g = snapshot.groupByTaxonomy(t);
                List<Object> categories = new ArrayList<>();
                for (AssetCategory c : g.asList())
                {
                    Map<String, Object> cm = new LinkedHashMap<>();
                    cm.put("id", c.getClassification().getId());
                    cm.put("valuation", c.getValuation().getAmount());
                    Map<String, Object> positions = new java.util.TreeMap<>();
                    for (AssetPosition p : c.getPositions())
                        positions.put(p.getInvestmentVehicle().getUUID(), p.getValuation().getAmount());
                    cm.put("positions", positions);
                    categories.add(cm);
                }
                taxonomies.add(categories);
            }
            m.put("groupByTaxonomy", taxonomies);
            snapshots.add(m);
        }
        root.put("snapshots", snapshots);

        // performance indices
        List<Object> indices = new ArrayList<>();
        for (String code : PERIODS)
        {
            ReportingPeriod period = ReportingPeriod.tryFrom(code).orElseThrow();
            Interval interval = period.toInterval(RELATIVE_TO);
            List<Exception> warnings = new ArrayList<>();
            PerformanceIndex index = PerformanceIndex.forClient(client, converter, interval, warnings);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("period", code);
            m.put("interval", interval(interval));
            m.put("actualInterval", interval(index.getActualInterval()));
            m.put("firstHolding", interval(index.getFirstHoldingInterval()));
            m.put("totals", index.getTotals());
            m.put("inbound", index.getInboundTransferals());
            m.put("outbound", index.getOutboundTransferals());
            m.put("taxes", index.getTaxes());
            m.put("dividends", index.getDividends());
            m.put("fees", index.getFees());
            m.put("interest", index.getInterest());
            m.put("interestCharge", index.getInterestCharge());
            m.put("buys", index.getBuys());
            m.put("sells", index.getSells());
            m.put("delta", index.getDeltaPercentage());
            m.put("accumulated", index.getAccumulatedPercentage());
            m.put("ttwror", index.getFinalAccumulatedPercentage());
            m.put("ttwrorPa", index.getFinalAccumulatedAnnualizedPercentage());
            Drawdown dd = index.getDrawdown();
            m.put("maxDD", dd.getMaxDrawdown());
            m.put("maxDDInterval", interval(dd.getIntervalOfMaxDrawdown()));
            m.put("maxDDDuration", interval(dd.getMaxDrawdownDuration()));
            m.put("recovery", interval(dd.getLongestRecoveryTime()));
            m.put("ddSerie", dd.getMaxDrawdownSerie());
            Volatility v = index.getVolatility();
            m.put("volatility", v.getStandardDeviation());
            m.put("semiDeviation", v.getSemiDeviation());
            m.put("investedCapital", index.calculateInvestedCapital());
            m.put("absoluteInvestedCapital", index.calculateAbsoluteInvestedCapital());
            m.put("absoluteDelta", index.calculateAbsoluteDelta());
            m.put("calcDelta", index.calculateDelta());
            m.put("firstDataPoint", index.getFirstDataPoint().map(LocalDate::toString).orElse(null));
            m.put("performanceLast90", index.getPerformance(Interval.of(interval.getEnd().minusDays(90), interval.getEnd())));
            m.put("warnings", warnings.size());
            Extra.addIndexExtras(m, client, converter, interval, index);
            indices.add(m);
        }
        root.put("indices", indices);
        Extra.addClientExtras(root, client, converter);
        return root;
    }
}
