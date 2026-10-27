package oracle;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import name.abuchen.portfolio.math.Risk.Drawdown;
import name.abuchen.portfolio.model.Account;
import name.abuchen.portfolio.model.Classification;
import name.abuchen.portfolio.model.Client;
import name.abuchen.portfolio.model.CostMethod;
import name.abuchen.portfolio.model.Portfolio;
import name.abuchen.portfolio.model.TaxesAndFees;
import name.abuchen.portfolio.model.Taxonomy;
import name.abuchen.portfolio.money.CurrencyConverter;
import name.abuchen.portfolio.money.Money;
import name.abuchen.portfolio.snapshot.ClientPerformanceSnapshot;
import name.abuchen.portfolio.snapshot.ClientPerformanceSnapshot.Category;
import name.abuchen.portfolio.snapshot.ClientPerformanceSnapshot.CategoryType;
import name.abuchen.portfolio.snapshot.ClientPerformanceSnapshot.Position;
import name.abuchen.portfolio.snapshot.PerformanceIndex;
import name.abuchen.portfolio.snapshot.filter.ClientClassificationFilter;
import name.abuchen.portfolio.snapshot.filter.ClientFilter;
import name.abuchen.portfolio.snapshot.filter.PortfolioClientFilter;
import name.abuchen.portfolio.snapshot.filter.WithoutTaxesFilter;
import name.abuchen.portfolio.snapshot.security.CapitalGainsRecord;
import name.abuchen.portfolio.snapshot.security.LazySecurityPerformanceRecord;
import name.abuchen.portfolio.snapshot.security.LazySecurityPerformanceSnapshot;
import name.abuchen.portfolio.util.Interval;

/** additional dumps */
public class Extra
{
    static String m(Money m)
    {
        return m == null ? null : m.getCurrencyCode() + " " + m.getAmount();
    }

    static Object d(double v)
    {
        if (Double.isNaN(v))
            return "NaN";
        if (Double.isInfinite(v))
            return v > 0 ? "Infinity" : "-Infinity";
        return v;
    }

    static Map<String, Object> performance(ClientPerformanceSnapshot s)
    {
        Map<String, Object> m = new LinkedHashMap<>();
        for (CategoryType type : CategoryType.values())
        {
            Category c = s.getCategoryByType(type);
            Map<String, Object> cm = new LinkedHashMap<>();
            cm.put("valuation", m(c.getValuation()));
            List<Object> positions = new ArrayList<>();
            for (Position p : c.getPositions())
                positions.add(p.getLabel() + "|" + m(p.getValue()) + "|" + m(p.getForexGain()));
            cm.put("positions", positions);
            m.put(type.name(), cm);
        }
        m.put("irr", d(s.getPerformanceIRR()));
        m.put("absoluteDelta", m(s.getAbsoluteDelta()));
        m.put("taxRate", d(s.getPortfolioTaxRate()));
        m.put("feeRate", d(s.getPortfolioFeeRate()));
        m.put("earnings", s.getEarnings().size());
        m.put("fees", s.getFees().size());
        m.put("taxes", s.getTaxes().size());
        return m;
    }

    static String cg(CapitalGainsRecord r)
    {
        return m(r.getCapitalGains()) + "|" + m(r.getForexCaptialGains());
    }

    static Map<String, Object> record(LazySecurityPerformanceRecord r)
    {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("irr", d(r.getIrr()));
        m.put("ttwror", d(r.getTrueTimeWeightedRateOfReturn()));
        m.put("ttwrorPa", d(r.getTrueTimeWeightedRateOfReturnAnnualized()));
        m.put("maxDD", d(r.getDrawdown().getMaxDrawdown()));
        m.put("volatility", d(r.getVolatility().getStandardDeviation()));
        m.put("delta", m(r.getDelta()));
        m.put("deltaPercent", d(r.getDeltaPercent()));
        m.put("marketValue", m(r.getMarketValue()));
        m.put("openingValue", m(r.getOpeningValue()));
        m.put("quote", r.getQuote().getAmount());
        m.put("quoteTerm", r.getQuoteInTermCurrency().getCurrencyCode() + " " + r.getQuoteInTermCurrency().getAmount());
        for (CostMethod cm : CostMethod.values())
        {
            for (TaxesAndFees tf : TaxesAndFees.values())
            {
                m.put("cost-" + cm.name() + "-" + tf, m(r.getCost(cm, tf)));
                m.put("costPerShare-" + cm.name() + "-" + tf, r.getCostPerSharesHeld(cm, tf).getAmount());
                m.put("realized-" + cm.name() + "-" + tf, cg(r.getRealizedCapitalGains(cm, tf)));
                m.put("unrealized-" + cm.name() + "-" + tf, cg(r.getUnrealizedCapitalGains(cm, tf)));
            }
            m.put("gainsOnHoldings-" + cm.name(), m(r.getCapitalGainsOnHoldings(cm)));
            m.put("gainsOnHoldingsPercent-" + cm.name(), d(r.getCapitalGainsOnHoldingsPercent(cm)));
            m.put("totalRateOfReturnDiv-" + cm.name(), d(r.getTotalRateOfReturnDiv(cm)));
        }
        m.put("fees", m(r.getFees()));
        m.put("taxes", m(r.getTaxes()));
        m.put("sharesHeld", r.getSharesHeld());
        m.put("dividends", m(r.getSumOfDividends()));
        m.put("dividendCount", r.getDividendEventCount());
        m.put("lastDividend", r.getLastDividendPayment() != null ? r.getLastDividendPayment().toString() : null);
        m.put("periodicity", r.getPeriodicity().name());
        m.put("rateOfReturnPerYear", d(r.getRateOfReturnPerYear()));
        return m;
    }

    static Map<String, Object> indexSummary(PerformanceIndex index)
    {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("totals", index.getTotals());
        m.put("inbound", index.getInboundTransferals());
        m.put("outbound", index.getOutboundTransferals());
        m.put("accumulated", index.getAccumulatedPercentage());
        m.put("ttwror", index.getFinalAccumulatedPercentage());
        Drawdown dd = index.getDrawdown();
        m.put("maxDD", dd.getMaxDrawdown());
        m.put("volatility", index.getVolatility().getStandardDeviation());
        m.put("irr", d(index.getPerformanceIRR()));
        return m;
    }

    static void addIndexExtras(Map<String, Object> m, Client client, CurrencyConverter converter, Interval interval,
                    PerformanceIndex index)
    {
        m.put("performanceFifo", performance(index.getClientPerformanceSnapshot(true).get()));
        m.put("performanceMovingAverage", performance(index.getClientPerformanceSnapshot(false).get()));

        LazySecurityPerformanceSnapshot snapshot = LazySecurityPerformanceSnapshot.create(client, converter, interval);
        Map<String, Object> records = new TreeMap<>();
        for (LazySecurityPerformanceRecord r : snapshot.getRecords())
            records.put(r.getSecurity().getUUID(), record(r));
        m.put("securities", records);

        String period = (String) m.get("period");
        if (!List.of("L1Y0", "Y2020", "Y2023", "S2017-12-01", "F2024-06-01_2026-01-01").contains(period))
            return;

        Map<String, Object> filtered = new LinkedHashMap<>();
        List<Portfolio> portfolios = client.getPortfolios();
        List<Account> accounts = client.getAccounts();
        Map<String, ClientFilter> filters = new LinkedHashMap<>();
        for (Portfolio p : portfolios)
        {
            filters.put("P:" + p.getName(), new PortfolioClientFilter(p));
            filters.put("PA:" + p.getName(), new PortfolioClientFilter(p, p.getReferenceAccount()));
        }
        for (Account a : accounts)
            filters.put("A:" + a.getName(), new PortfolioClientFilter(List.of(), List.of(a)));
        filters.put("P0+P1", new PortfolioClientFilter(List.of(portfolios.get(0), portfolios.get(1)), List.of()));
        filters.put("P0+A1", new PortfolioClientFilter(List.of(portfolios.get(0)), List.of(accounts.get(1))));
        Map<Object, Integer> weights = new HashMap<>();
        weights.put(portfolios.get(0), 5000);
        weights.put(accounts.get(0), 2500);
        filters.put("weighted", new PortfolioClientFilter(List.of(portfolios.get(0), portfolios.get(1)),
                        List.of(accounts.get(0), accounts.get(2)), weights));
        filters.put("withoutTaxes", new WithoutTaxesFilter());
        for (Taxonomy t : client.getTaxonomies())
            for (Classification c : t.getRoot().getChildren())
                filters.put("C:" + c.getId(), new ClientClassificationFilter(c));
        filters.put("C:root", new ClientClassificationFilter(client.getTaxonomies().get(0).getRoot()));

        for (Map.Entry<String, ClientFilter> e : filters.entrySet())
        {
            Client fc = e.getValue().filter(client);
            List<Exception> warnings = new ArrayList<>();
            PerformanceIndex fi = PerformanceIndex.forClient(fc, converter, interval, warnings);
            Map<String, Object> fm = indexSummary(fi);
            fm.put("performance", performance(fi.getClientPerformanceSnapshot().get()));
            filtered.put(e.getKey(), fm);
        }
        m.put("filtered", filtered);
    }

    static List<Object> trade(name.abuchen.portfolio.snapshot.trades.Trade t)
    {
        List<Object> l = new ArrayList<>();
        l.add(t.getSecurity().getUUID() + "|" + t.getPortfolio().getUUID() + "|" + t.getStart() + "|"
                        + t.getEnd().map(Object::toString).orElse("open") + "|" + t.getShares());
        l.add(m(t.getEntryValue()));
        l.add(m(t.getEntryValueWithoutTaxesAndFees()));
        l.add(m(t.getExitValue()));
        l.add(m(t.getExitValueWithoutTaxesAndFees()));
        l.add(m(t.getProfitLoss()));
        l.add(m(t.getProfitLossWithoutTaxesAndFees()));
        l.add(m(t.getProfitLossMovingAverage()));
        l.add(m(t.getProfitLossMovingAverageWithoutTaxesAndFees()));
        l.add(t.getHoldingPeriod());
        l.add(d(t.getIRR()));
        l.add(d(t.getReturn()));
        l.add(d(t.getReturnMovingAverage()));
        l.add(t.getTransactions().size());
        l.add(t.isLong());
        return l;
    }

    static void addClientExtras(Map<String, Object> root, Client client, CurrencyConverter converter)
    {
        // trades
        for (var grouping : name.abuchen.portfolio.snapshot.trades.TradeGrouping.values())
        {
            var collector = new name.abuchen.portfolio.snapshot.trades.TradeCollector(client, converter, grouping,
                            new name.abuchen.portfolio.snapshot.security.SnapshotCache());
            List<name.abuchen.portfolio.snapshot.trades.Trade> trades = new ArrayList<>();
            List<List<Object>> lines = new ArrayList<>();
            List<Object> errors = new ArrayList<>();
            for (var s : client.getSecurities())
            {
                try
                {
                    var list = collector.collect(s);
                    trades.addAll(list);
                    for (var t : list)
                        lines.add(trade(t));
                }
                catch (name.abuchen.portfolio.snapshot.trades.TradeCollectorException e)
                {
                    errors.add(s.getUUID());
                }
            }
            lines.sort((a, b) -> ((String) a.get(0)).compareTo((String) b.get(0)));
            Map<String, Object> tm = new LinkedHashMap<>();
            tm.put("trades", lines);
            tm.put("errors", errors);
            var totals = new name.abuchen.portfolio.snapshot.trades.TradeTotals(
                            new name.abuchen.portfolio.snapshot.trades.TradesGroupedByTaxonomy(null, trades, converter));
            tm.put("totals", List.of(totals.getTradeCount(), totals.getTotalShares(), m(totals.getTotalEntryValue()),
                            m(totals.getTotalEntryValueMovingAverage()), m(totals.getTotalExitValue()),
                            m(totals.getTotalProfitLoss()), m(totals.getTotalProfitLossWithoutTaxesAndFees()),
                            m(totals.getTotalProfitLossMovingAverage()),
                            m(totals.getTotalProfitLossMovingAverageWithoutTaxesAndFees()),
                            totals.getAverageHoldingPeriod(), d(totals.getAverageIRR()), d(totals.getAverageReturn()),
                            d(totals.getAverageReturnMovingAverage())));
            root.put("trades-" + grouping.name(), tm);
        }

        // payments
        Map<String, Object> payments = new LinkedHashMap<>();
        for (var mode : oracle.ui.PaymentsViewModel.Mode.values())
        {
            for (boolean gross : new boolean[] { true, false })
            {
                for (CostMethod cm : CostMethod.values())
                {
                    if (cm == CostMethod.MOVING_AVERAGE && !mode.includesTradeProfitLoss())
                        continue;
                    if (!gross && mode != oracle.ui.PaymentsViewModel.Mode.DIVIDENDS
                                    && mode != oracle.ui.PaymentsViewModel.Mode.EARNINGS)
                        continue;
                    var model = new oracle.ui.PaymentsViewModel(converter, client);
                    model.configure(2019, mode, gross, true, cm);
                    Map<String, Object> pm = new LinkedHashMap<>();
                    pm.put("months", model.getNoOfMonths());
                    pm.put("sum", model.getSum().getSum());
                    long[] values = new long[model.getNoOfMonths()];
                    int[] counts = new int[model.getNoOfMonths()];
                    for (int ii = 0; ii < values.length; ii++)
                    {
                        values[ii] = model.getSum().getValue(ii);
                        counts[ii] = model.getSum().getNumTransations(ii);
                    }
                    pm.put("values", values);
                    pm.put("counts", counts);
                    pm.put("retired", model.getSumRetired().getSum());
                    Map<String, Object> lines = new TreeMap<>();
                    for (var line : model.getLines())
                    {
                        StringBuilder b = new StringBuilder();
                        b.append(line.getSum());
                        for (int ii = 0; ii < line.getNoOfMonths(); ii++)
                            if (line.getValue(ii) != 0)
                                b.append(',').append(ii).append('=').append(line.getValue(ii)).append('/')
                                                .append(line.getNumTransations(ii));
                        lines.put(line.getVehicle().getUUID(), b.toString());
                    }
                    pm.put("lines", lines);
                    pm.put("transactions", model.getTransactions().size());
                    payments.put(mode.name() + "-" + gross + "-" + cm.name(), pm);
                }
            }
        }
        root.put("payments", payments);

        // benchmarks, aggregation, all time high
        Map<String, Object> benchmarks = new LinkedHashMap<>();
        for (String code : List.of("L1Y0", "L3Y0", "Y2021", "S2017-12-01"))
        {
            Interval interval = name.abuchen.portfolio.snapshot.ReportingPeriod.tryFrom(code).orElseThrow()
                            .toInterval(CalcDump.RELATIVE_TO);
            PerformanceIndex clientIndex = PerformanceIndex.forClient(client, converter, interval, new ArrayList<>());
            Map<String, Object> bm = new LinkedHashMap<>();
            for (var s : client.getSecurities())
            {
                PerformanceIndex si = PerformanceIndex.forSecurity(clientIndex, s);
                Map<String, Object> sm = new LinkedHashMap<>();
                sm.put("dates", si.getDates()[0] + ".." + si.getDates()[si.getDates().length - 1]);
                sm.put("totals", si.getTotals());
                sm.put("accumulated", si.getAccumulatedPercentage());
                sm.put("irr", d(si.getPerformanceIRR()));
                var ath = new name.abuchen.portfolio.math.AllTimeHigh(s, interval);
                List<Object> athl = new ArrayList<>();
                athl.add(ath.getValue());
                athl.add(ath.getDate() == null ? null : ath.getDate().toString());
                athl.add(ath.getLow());
                athl.add(ath.getLowDate() == null ? null : ath.getLowDate().toString());
                athl.add(ath.getDistance() == null ? null : d(ath.getDistance()));
                athl.add(ath.getRelLowDistance() == null ? null : d(ath.getRelLowDistance()));
                sm.put("ath", athl);
                bm.put(s.getUUID(), sm);
            }
            for (var period : name.abuchen.portfolio.snapshot.Aggregation.Period.values())
            {
                PerformanceIndex ai = name.abuchen.portfolio.snapshot.Aggregation.aggregate(clientIndex, period);
                Map<String, Object> am = new LinkedHashMap<>();
                List<String> dates = new ArrayList<>();
                for (LocalDate date : ai.getDates())
                    dates.add(date.toString());
                am.put("dates", dates);
                am.put("accumulated", ai.getAccumulatedPercentage());
                am.put("delta", ai.getDeltaPercentage());
                am.put("inbound", ai.getInboundTransferals());
                am.put("outbound", ai.getOutboundTransferals());
                am.put("totals", ai.getTotals());
                bm.put("aggregation-" + period.name(), am);
            }
            benchmarks.put(code, bm);
        }
        root.put("benchmarks", benchmarks);

    }
}
