package oracle;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

import name.abuchen.portfolio.model.Account;
import name.abuchen.portfolio.model.AccountTransaction;
import name.abuchen.portfolio.model.AccountTransferEntry;
import name.abuchen.portfolio.model.BuySellEntry;
import name.abuchen.portfolio.model.Classification;
import name.abuchen.portfolio.model.Classification.Assignment;
import name.abuchen.portfolio.model.Client;
import name.abuchen.portfolio.model.ClientFactory;
import name.abuchen.portfolio.model.Dashboard;
import name.abuchen.portfolio.model.InvestmentPlan;
import name.abuchen.portfolio.model.LatestSecurityPrice;
import name.abuchen.portfolio.model.Portfolio;
import name.abuchen.portfolio.model.PortfolioTransaction;
import name.abuchen.portfolio.model.PortfolioTransferEntry;
import name.abuchen.portfolio.model.SaveFlag;
import name.abuchen.portfolio.model.Security;
import name.abuchen.portfolio.model.SecurityEvent;
import name.abuchen.portfolio.model.SecurityPrice;
import name.abuchen.portfolio.model.Taxonomy;
import name.abuchen.portfolio.model.Transaction.Unit;
import name.abuchen.portfolio.model.Watchlist;
import name.abuchen.portfolio.money.Money;
import name.abuchen.portfolio.money.Values;

/**
 * Generates random but consistent Portfolio Performance files.
 * Usage: Generator <seed> <outdir> [complexity]
 */
public class Generator
{
    static final LocalDate START = LocalDate.of(2018, 1, 1);
    static final LocalDate END = LocalDate.of(2025, 6, 30);

    final Random rnd;
    final int complexity;
    final Client client = new Client();
    final Map<String, Map<LocalDate, BigDecimal>> fx = new HashMap<>(); // EUR -> X
    final List<String> fxCurrencies = List.of("USD", "CHF", "GBP");
    final Map<Security, Long> lastPrice = new HashMap<>();
    final Map<Portfolio, Map<Security, Long>> holdings = new HashMap<>();

    Generator(long seed, int complexity)
    {
        this.rnd = new Random(seed);
        this.complexity = complexity;
    }

    static boolean isWeekday(LocalDate d)
    {
        return d.getDayOfWeek() != DayOfWeek.SATURDAY && d.getDayOfWeek() != DayOfWeek.SUNDAY;
    }

    void generateFx()
    {
        Map<String, Double> current = new HashMap<>(Map.of("USD", 1.15, "CHF", 1.12, "GBP", 0.88));
        for (String c : fxCurrencies)
            fx.put(c, new HashMap<>());
        for (LocalDate d = START.minusDays(30); !d.isAfter(END.plusDays(30)); d = d.plusDays(1))
        {
            if (!isWeekday(d))
                continue;
            for (String c : fxCurrencies)
            {
                double v = current.get(c) * (1 + (rnd.nextGaussian() * 0.004));
                current.put(c, v);
                fx.get(c).put(d, BigDecimal.valueOf(v).setScale(4, RoundingMode.HALF_UP));
            }
        }
    }

    BigDecimal rate(String currency, LocalDate date)
    {
        // EUR -> currency, last available
        LocalDate d = date;
        while (!fx.get(currency).containsKey(d))
            d = d.minusDays(1);
        return fx.get(currency).get(d);
    }

    void writeFx(File file) throws IOException
    {
        try (PrintWriter w = new PrintWriter(new FileWriter(file)))
        {
            w.println("Date," + String.join(",", fxCurrencies));
            List<LocalDate> dates = new ArrayList<>(fx.get("USD").keySet());
            dates.sort(null);
            for (LocalDate d : dates)
            {
                StringBuilder b = new StringBuilder(d.toString());
                for (String c : fxCurrencies)
                    b.append(',').append(fx.get(c).get(d).toPlainString());
                w.println(b);
            }
        }
    }

    Security security(String name, String currency, double startPrice, boolean withPrices)
    {
        Security s = new Security(name, currency);
        s.setIsin("DE000" + (100000 + rnd.nextInt(899999)) + "X");
        s.setTickerSymbol(name.substring(0, Math.min(4, name.length())).toUpperCase());
        s.setWkn(String.valueOf(100000 + rnd.nextInt(899999)));
        double p = startPrice;
        if (withPrices)
        {
            LocalDate first = START.plusDays(rnd.nextInt(200));
            LocalDate last = END.minusDays(rnd.nextInt(60));
            for (LocalDate d = first; !d.isAfter(last); d = d.plusDays(1))
            {
                if (!isWeekday(d))
                    continue;
                p = p * (1 + 0.0003 + rnd.nextGaussian() * 0.015);
                if (rnd.nextInt(50) == 0)
                    continue; // missing quote
                long v = Math.round(p * 10000) * 10000L;
                s.addPrice(new SecurityPrice(d, v));
            }
            if (rnd.nextBoolean())
            {
                long v = Math.round(p * 1.01 * 10000) * 10000L;
                s.setLatest(new LatestSecurityPrice(last.plusDays(rnd.nextInt(5)), v, v + 100000000L, v - 100000000L,
                                12345));
            }
        }
        client.addSecurity(s);
        return s;
    }

    long priceAt(Security s, LocalDate d)
    {
        SecurityPrice p = s.getSecurityPrice(d);
        long v = p.getValue();
        if (v == 0)
            v = lastPrice.getOrDefault(s, 50_00000000L);
        lastPrice.put(s, v);
        return v;
    }

    Money convertEUR(String currency, long amountInCurrency, LocalDate d)
    {
        // amount in currency -> EUR
        if (currency.equals("EUR"))
            return Money.of("EUR", amountInCurrency);
        BigDecimal r = rate(currency, d);
        return Money.of("EUR", BigDecimal.valueOf(amountInCurrency).divide(r, 0, RoundingMode.HALF_UP).longValue());
    }

    Account account(String name, String currency)
    {
        Account a = new Account(name);
        a.setCurrencyCode(currency);
        client.addAccount(a);
        return a;
    }

    Portfolio portfolio(String name, Account ref)
    {
        Portfolio p = new Portfolio(name);
        p.setReferenceAccount(ref);
        client.addPortfolio(p);
        holdings.put(p, new HashMap<>());
        return p;
    }

    /** returns exchange rate (account currency per security currency) */
    BigDecimal crossRate(String accountCurrency, String securityCurrency, LocalDate d)
    {
        // value in account currency = rate * value in security currency
        BigDecimal toEurFromSec = securityCurrency.equals("EUR") ? BigDecimal.ONE
                        : BigDecimal.ONE.divide(rate(securityCurrency, d), 10, RoundingMode.HALF_UP);
        BigDecimal toAccFromEur = accountCurrency.equals("EUR") ? BigDecimal.ONE : rate(accountCurrency, d);
        return toEurFromSec.multiply(toAccFromEur).setScale(6, RoundingMode.HALF_UP);
    }

    void buySell(Portfolio portfolio, Account account, Security security, LocalDate d, boolean buy, long shares)
    {
        long price = priceAt(security, d); // per share in security currency (quote)
        long grossSec = BigDecimal.valueOf(shares).multiply(BigDecimal.valueOf(price))
                        .divide(BigDecimal.valueOf(Values.Share.factor()).multiply(BigDecimal.valueOf(Values.Quote.factorToMoney())), 0,
                                        RoundingMode.HALF_UP)
                        .longValue();
        if (grossSec <= 0)
            return;
        BuySellEntry entry = new BuySellEntry(portfolio, account);
        entry.setType(buy ? PortfolioTransaction.Type.BUY : PortfolioTransaction.Type.SELL);
        entry.setDate(d.atTime(rnd.nextInt(3) == 0 ? 0 : 9 + rnd.nextInt(8), rnd.nextInt(60)));
        entry.setSecurity(security);
        entry.setShares(shares);
        entry.setCurrencyCode(account.getCurrencyCode());

        long gross;
        Unit grossUnit = null;
        if (!security.getCurrencyCode().equals(account.getCurrencyCode()))
        {
            BigDecimal r = crossRate(account.getCurrencyCode(), security.getCurrencyCode(), d);
            gross = r.multiply(BigDecimal.valueOf(grossSec)).setScale(0, RoundingMode.HALF_UP).longValue();
            grossUnit = new Unit(Unit.Type.GROSS_VALUE, Money.of(account.getCurrencyCode(), gross),
                            Money.of(security.getCurrencyCode(), grossSec), r);
        }
        else
        {
            gross = grossSec;
        }
        long fee = rnd.nextInt(3) == 0 ? 0 : 100 + rnd.nextInt(1500);
        long tax = buy || rnd.nextBoolean() ? 0 : Math.max(0, gross / 50 + rnd.nextInt(2000));
        long amount = buy ? gross + fee + tax : gross - fee - tax;
        if (amount <= 0)
            return;
        entry.setAmount(amount);
        PortfolioTransaction ptx = entry.getPortfolioTransaction();
        if (grossUnit != null)
            ptx.addUnit(grossUnit);
        if (fee > 0)
        {
            if (grossUnit != null && rnd.nextBoolean())
            {
                BigDecimal r = grossUnit.getExchangeRate();
                long feeSec = BigDecimal.valueOf(fee).divide(r, 0, RoundingMode.HALF_UP).longValue();
                long feeAcc = r.multiply(BigDecimal.valueOf(feeSec)).setScale(0, RoundingMode.HALF_UP).longValue();
                // keep amount consistent
                entry.setAmount(amount = buy ? gross + feeAcc + tax : gross - feeAcc - tax);
                ptx.addUnit(new Unit(Unit.Type.FEE, Money.of(account.getCurrencyCode(), feeAcc),
                                Money.of(security.getCurrencyCode(), feeSec), r));
            }
            else
            {
                ptx.addUnit(new Unit(Unit.Type.FEE, Money.of(account.getCurrencyCode(), fee)));
            }
        }
        if (tax > 0)
            ptx.addUnit(new Unit(Unit.Type.TAX, Money.of(account.getCurrencyCode(), tax)));
        if (rnd.nextInt(5) == 0)
            entry.setNote("Order " + rnd.nextInt(10000));
        entry.insert();
        holdings.get(portfolio).merge(security, buy ? shares : -shares, Long::sum);
    }

    void dividend(Account account, Security security, LocalDate d, long shares)
    {
        long perShare = 10 + rnd.nextInt(200); // cents per share in sec currency
        long grossSec = BigDecimal.valueOf(shares).multiply(BigDecimal.valueOf(perShare))
                        .divide(BigDecimal.valueOf(Values.Share.factor()), 0, RoundingMode.HALF_UP).longValue();
        if (grossSec <= 0)
            return;
        AccountTransaction t = new AccountTransaction();
        t.setType(AccountTransaction.Type.DIVIDENDS);
        t.setDateTime(d.atStartOfDay());
        t.setSecurity(security);
        t.setShares(shares);
        t.setCurrencyCode(account.getCurrencyCode());
        long gross = grossSec;
        Unit grossUnit = null;
        if (!security.getCurrencyCode().equals(account.getCurrencyCode()))
        {
            BigDecimal r = crossRate(account.getCurrencyCode(), security.getCurrencyCode(), d);
            gross = r.multiply(BigDecimal.valueOf(grossSec)).setScale(0, RoundingMode.HALF_UP).longValue();
            grossUnit = new Unit(Unit.Type.GROSS_VALUE, Money.of(account.getCurrencyCode(), gross),
                            Money.of(security.getCurrencyCode(), grossSec), r);
        }
        long tax = rnd.nextInt(4) == 0 ? 0 : gross / 4;
        long fee = rnd.nextInt(6) == 0 ? 10 + rnd.nextInt(100) : 0;
        if (gross - tax - fee <= 0)
            return;
        t.setAmount(gross - tax - fee);
        if (grossUnit != null)
            t.addUnit(grossUnit);
        if (tax > 0)
            t.addUnit(new Unit(Unit.Type.TAX, Money.of(account.getCurrencyCode(), tax)));
        if (fee > 0)
            t.addUnit(new Unit(Unit.Type.FEE, Money.of(account.getCurrencyCode(), fee)));
        if (rnd.nextBoolean())
            t.setExDate(d.minusDays(3).atStartOfDay());
        account.addTransaction(t);
    }

    void simple(Account account, AccountTransaction.Type type, LocalDate d, long amount, Security security)
    {
        AccountTransaction t = new AccountTransaction();
        t.setType(type);
        t.setDateTime(d.atTime(rnd.nextInt(2) == 0 ? 0 : 12, 0));
        t.setCurrencyCode(account.getCurrencyCode());
        t.setAmount(amount);
        if (security != null)
            t.setSecurity(security);
        if (type == AccountTransaction.Type.INTEREST && rnd.nextBoolean())
        {
            long tax = amount / 4;
            t.setAmount(amount - tax);
            if (tax > 0)
                t.addUnit(new Unit(Unit.Type.TAX, Money.of(account.getCurrencyCode(), tax)));
        }
        account.addTransaction(t);
    }

    void cashTransfer(Account from, Account to, LocalDate d, long amount)
    {
        AccountTransferEntry entry = new AccountTransferEntry(from, to);
        entry.setDate(d.atStartOfDay());
        entry.setCurrencyCode(from.getCurrencyCode());
        entry.setAmount(amount);
        if (!from.getCurrencyCode().equals(to.getCurrencyCode()))
        {
            // rate: from currency per to currency
            BigDecimal r = crossRate(from.getCurrencyCode(), to.getCurrencyCode(), d);
            long toAmount = BigDecimal.valueOf(amount).divide(r, 0, RoundingMode.HALF_UP).longValue();
            entry.getTargetTransaction().setCurrencyCode(to.getCurrencyCode());
            entry.getTargetTransaction().setAmount(toAmount);
            entry.getSourceTransaction().addUnit(new Unit(Unit.Type.GROSS_VALUE,
                            Money.of(from.getCurrencyCode(), amount), Money.of(to.getCurrencyCode(), toAmount), r));
        }
        entry.insert();
    }

    void securityTransfer(Portfolio from, Portfolio to, Security security, LocalDate d, long shares)
    {
        long price = priceAt(security, d);
        long value = BigDecimal.valueOf(shares).multiply(BigDecimal.valueOf(price))
                        .divide(BigDecimal.valueOf(100000000L).multiply(BigDecimal.valueOf(1000000L)), 0,
                                        RoundingMode.HALF_UP)
                        .longValue();
        PortfolioTransferEntry entry = new PortfolioTransferEntry(from, to);
        entry.setDate(d.atStartOfDay());
        entry.setSecurity(security);
        entry.setShares(shares);
        entry.setCurrencyCode(security.getCurrencyCode());
        entry.setAmount(value);
        entry.insert();
        holdings.get(from).merge(security, -shares, Long::sum);
        holdings.get(to).merge(security, shares, Long::sum);
    }

    void delivery(Portfolio portfolio, Security security, LocalDate d, long shares, boolean inbound)
    {
        long price = priceAt(security, d);
        long value = BigDecimal.valueOf(shares).multiply(BigDecimal.valueOf(price))
                        .divide(BigDecimal.valueOf(100000000L).multiply(BigDecimal.valueOf(1000000L)), 0,
                                        RoundingMode.HALF_UP)
                        .longValue();
        PortfolioTransaction t = new PortfolioTransaction();
        t.setType(inbound ? PortfolioTransaction.Type.DELIVERY_INBOUND : PortfolioTransaction.Type.DELIVERY_OUTBOUND);
        t.setDateTime(d.atStartOfDay());
        t.setSecurity(security);
        t.setShares(shares);
        String currency = portfolio.getReferenceAccount().getCurrencyCode();
        t.setCurrencyCode(currency);
        if (!currency.equals(security.getCurrencyCode()))
        {
            BigDecimal r = crossRate(currency, security.getCurrencyCode(), d);
            long gross = r.multiply(BigDecimal.valueOf(value)).setScale(0, RoundingMode.HALF_UP).longValue();
            t.setAmount(gross);
            t.addUnit(new Unit(Unit.Type.GROSS_VALUE, Money.of(currency, gross),
                            Money.of(security.getCurrencyCode(), value), r));
        }
        else
        {
            t.setAmount(value);
        }
        if (value <= 0)
            return;
        portfolio.addTransaction(t);
        holdings.get(portfolio).merge(security, inbound ? shares : -shares, Long::sum);
    }

    long randomShares()
    {
        int kind = rnd.nextInt(3);
        if (kind == 0)
            return (1 + rnd.nextInt(50)) * Values.Share.factor();
        else if (kind == 1)
            return (1 + rnd.nextInt(5000)) * Values.Share.factor() / 100;
        else
            return 1 + (long) (rnd.nextDouble() * 20 * Values.Share.factor());
    }

    void generate()
    {
        generateFx();

        client.setBaseCurrency("EUR");

        Account eur = account("Girokonto", "EUR");
        Account eur2 = account("Tagesgeld", "EUR");
        Account usd = account("USD Konto", "USD");
        Account chf = account("CHF Konto", "CHF");
        Account retired = account("Altes Konto", "EUR");

        Portfolio depotA = portfolio("Depot A", eur);
        Portfolio depotB = portfolio("Depot B", usd);
        Portfolio depotC = portfolio("Depot CH", chf);

        List<Security> securities = new ArrayList<>();
        int n = 4 + complexity * 3;
        String[] names = { "Alpha AG", "Beta SE", "Gamma Corp", "Delta Inc", "Epsilon ETF", "Zeta Fonds", "Eta Holding",
                        "Theta Plc", "Iota Ltd", "Kappa NV", "Lambda SA", "My Tech", "Nu Bank", "Xi Energy",
                        "Omicron Chem", "Pi Pharma" };
        String[] ccy = { "EUR", "EUR", "USD", "USD", "EUR", "CHF", "GBP", "EUR", "USD", "EUR", "CHF", "USD", "EUR",
                        "EUR", "USD", "EUR" };
        for (int ii = 0; ii < n && ii < names.length; ii++)
            securities.add(security(names[ii], ccy[ii], 20 + rnd.nextInt(200), true));
        // security without prices
        Security noPrices = security("Ohne Kurse GmbH", "EUR", 0, false);
        securities.add(noPrices);
        Security retiredSec = security("Ausgemustert AG", "EUR", 30, true);
        retiredSec.setRetired(true);
        securities.add(retiredSec);

        // stock split event
        securities.get(0).addEvent(new SecurityEvent(LocalDate.of(2021, 6, 1), SecurityEvent.Type.STOCK_SPLIT, "1:4"));
        securities.get(1).addEvent(new SecurityEvent(LocalDate.of(2020, 3, 2), SecurityEvent.Type.NOTE, "Notiz"));
        securities.get(1).addEvent(new SecurityEvent.DividendEvent(LocalDate.of(2024, 5, 2), LocalDate.of(2024, 5, 6),
                        Money.of("EUR", 123), "divvydiary.com"));

        // initial deposits
        simple(eur, AccountTransaction.Type.DEPOSIT, START.plusDays(rnd.nextInt(10)), 5_000_000 + rnd.nextInt(5_000_000), null);
        simple(usd, AccountTransaction.Type.DEPOSIT, START.plusDays(5), 1_000_000, null);
        simple(chf, AccountTransaction.Type.DEPOSIT, START.plusDays(8), 500_000, null);
        simple(retired, AccountTransaction.Type.DEPOSIT, START.plusDays(3), 10_000, null);
        simple(retired, AccountTransaction.Type.REMOVAL, START.plusDays(40), 10_000, null);
        retired.setRetired(true);

        int events = 150 + complexity * 120;
        long span = java.time.temporal.ChronoUnit.DAYS.between(START, END);
        List<LocalDate> dates = new ArrayList<>();
        for (int ii = 0; ii < events; ii++)
            dates.add(START.plusDays(15 + (long) (rnd.nextDouble() * (span - 15))));
        dates.sort(null);

        Portfolio[] portfolios = { depotA, depotA, depotA, depotB, depotC };

        for (LocalDate d : dates)
        {
            int action = rnd.nextInt(100);
            Portfolio p = portfolios[rnd.nextInt(portfolios.length)];
            Account acc = p.getReferenceAccount();
            if (rnd.nextInt(6) == 0 && p == depotA)
                acc = usd; // buy from a different account
            Security s = securities.get(rnd.nextInt(securities.size() - 1)); // not retired mostly

            if (action < 35)
            {
                buySell(p, acc, s, d, true, randomShares());
            }
            else if (action < 50)
            {
                Map<Security, Long> h = holdings.get(p);
                List<Security> held = h.entrySet().stream().filter(e -> e.getValue() > 0).map(Map.Entry::getKey).toList();
                if (held.isEmpty())
                    continue;
                Security sell = held.get(rnd.nextInt(held.size()));
                long all = h.get(sell);
                long shares = rnd.nextInt(3) == 0 ? all : Math.max(1, all / (2 + rnd.nextInt(3)));
                buySell(p, acc, sell, d, false, shares);
            }
            else if (action < 65)
            {
                Map<Security, Long> h = holdings.get(p);
                List<Security> held = h.entrySet().stream().filter(e -> e.getValue() > 0).map(Map.Entry::getKey).toList();
                if (held.isEmpty())
                    continue;
                Security div = held.get(rnd.nextInt(held.size()));
                dividend(acc, div, d, h.get(div));
            }
            else if (action < 70)
            {
                simple(acc, AccountTransaction.Type.DEPOSIT, d, 100_000 + rnd.nextInt(1_000_000), null);
            }
            else if (action < 73)
            {
                simple(acc, AccountTransaction.Type.REMOVAL, d, 10_000 + rnd.nextInt(300_000), null);
            }
            else if (action < 76)
            {
                simple(eur2, AccountTransaction.Type.INTEREST, d, 100 + rnd.nextInt(5000), null);
            }
            else if (action < 78)
            {
                simple(acc, AccountTransaction.Type.FEES, d, 100 + rnd.nextInt(2000), rnd.nextBoolean() ? s : null);
            }
            else if (action < 79)
            {
                simple(acc, AccountTransaction.Type.FEES_REFUND, d, 50 + rnd.nextInt(500), null);
            }
            else if (action < 81)
            {
                simple(acc, AccountTransaction.Type.TAXES, d, 100 + rnd.nextInt(5000), rnd.nextBoolean() ? s : null);
            }
            else if (action < 82)
            {
                simple(acc, AccountTransaction.Type.TAX_REFUND, d, 100 + rnd.nextInt(3000), rnd.nextBoolean() ? s : null);
            }
            else if (action < 83)
            {
                simple(eur, AccountTransaction.Type.INTEREST_CHARGE, d, 100 + rnd.nextInt(3000), null);
            }
            else if (action < 87)
            {
                Account[] all = { eur, eur2, usd, chf };
                Account from = all[rnd.nextInt(all.length)];
                Account to = all[rnd.nextInt(all.length)];
                if (from != to)
                    cashTransfer(from, to, d, 10_000 + rnd.nextInt(500_000));
            }
            else if (action < 90)
            {
                Map<Security, Long> h = holdings.get(depotA);
                List<Security> held = h.entrySet().stream().filter(e -> e.getValue() > 0).map(Map.Entry::getKey).toList();
                if (held.isEmpty())
                    continue;
                Security t = held.get(rnd.nextInt(held.size()));
                long shares = rnd.nextBoolean() ? h.get(t) : Math.max(1, h.get(t) / 2);
                securityTransfer(depotA, rnd.nextBoolean() ? depotB : depotC, t, d, shares);
            }
            else if (action < 94)
            {
                delivery(p, s, d, randomShares(), true);
            }
            else if (action < 96)
            {
                Map<Security, Long> h = holdings.get(p);
                List<Security> held = h.entrySet().stream().filter(e -> e.getValue() > 0).map(Map.Entry::getKey).toList();
                if (held.isEmpty())
                    continue;
                Security t = held.get(rnd.nextInt(held.size()));
                delivery(p, t, d, Math.max(1, h.get(t) / 3), false);
            }
            else
            {
                // same day purchase and sale
                long shares = randomShares();
                buySell(p, acc, s, d, true, shares);
                buySell(p, acc, s, d, false, shares / 2);
            }
        }

        // security with only a buy (no prices) to test fallback
        buySell(depotA, eur, noPrices, LocalDate.of(2022, 2, 2), true, 10 * Values.Share.factor());

        // taxonomy
        Taxonomy taxonomy = new Taxonomy("Anlageklassen");
        Classification root = new Classification(null, "root-" + rnd.nextInt(1000), "Anlageklassen");
        taxonomy.setRootNode(root);
        Classification stocks = new Classification(root, "stocks", "Aktien", "#4472c4");
        stocks.setRank(1);
        root.addChild(stocks);
        Classification bonds = new Classification(root, "bonds", "Anleihen", "#ed7d31");
        bonds.setRank(0);
        root.addChild(bonds);
        Classification cash = new Classification(root, "cash", "Liquidität", "#a5a5a5");
        cash.setRank(2);
        root.addChild(cash);
        Classification us = new Classification(stocks, "us", "USA", "#70ad47");
        stocks.addChild(us);
        Classification eu = new Classification(stocks, "eu", "Europa", "#5b9bd5");
        stocks.addChild(eu);
        stocks.setWeight(6000);
        bonds.setWeight(3000);
        cash.setWeight(1000);
        for (int ii = 0; ii < securities.size(); ii++)
        {
            Security s = securities.get(ii);
            int k = ii % 4;
            if (k == 0)
                eu.addAssignment(new Assignment(s));
            else if (k == 1)
                us.addAssignment(new Assignment(s));
            else if (k == 2)
            {
                eu.addAssignment(new Assignment(s, 5000));
                bonds.addAssignment(new Assignment(s, 3000));
            }
            // k == 3: unassigned
        }
        cash.addAssignment(new Assignment(eur));
        cash.addAssignment(new Assignment(eur2, 7000));
        client.addTaxonomy(taxonomy);

        // watchlist
        Watchlist w = new Watchlist();
        w.setName("Beobachtung");
        w.addSecurity(securities.get(1));
        w.addSecurity(securities.get(2));
        client.addWatchlist(w);

        // investment plan
        InvestmentPlan plan = new InvestmentPlan("Sparplan ETF");
        plan.setSecurity(securities.get(4));
        plan.setPortfolio(depotA);
        plan.setAccount(eur);
        plan.setStart(LocalDate.of(2020, 1, 15));
        plan.setInterval(1);
        plan.setAmount(10000);
        plan.setFees(150);
        plan.setType(InvestmentPlan.Type.PURCHASE_OR_DELIVERY);
        client.addPlan(plan);

        // dashboard
        Dashboard dashboard = new Dashboard("dash-1");
        dashboard.setName("Übersicht");
        Dashboard.Column c1 = new Dashboard.Column();
        Dashboard.Column c2 = new Dashboard.Column();
        c2.setWeight(2);
        dashboard.getColumns().add(c1);
        dashboard.getColumns().add(c2);
        String[][] widgets = { { "HEADING", "Kennzahlen" }, { "TOTAL_SUM", "Vermögen" }, { "TTWROR", "TTWROR" },
                        { "IRR", "IZF" }, { "ABSOLUTE_CHANGE", "Abs. Veränderung" }, { "DELTA", "Delta" },
                        { "MAXDRAWDOWN", "Max Drawdown" }, { "VOLATILITY", "Volatilität" },
                        { "CHART_CALCULATION", "Performance" }, { "EARNINGS_PER_MONTH_CHART", "Erträge" },
                        { "CURRENT_DATE", "Datum" } };
        for (int ii = 0; ii < widgets.length; ii++)
        {
            Dashboard.Widget widget = new Dashboard.Widget();
            widget.setType(widgets[ii][0]);
            widget.setLabel(widgets[ii][1]);
            if (ii > 0)
                widget.getConfiguration().put("REPORTING_PERIOD", ii % 2 == 0 ? "L1Y0" : "Y2");
            (ii % 2 == 0 ? c1 : c2).getWidgets().add(widget);
        }
        dashboard.getConfiguration().put("LAYOUT", "THREE_COLUMNS");
        client.addDashboard(dashboard);

        client.setProperty("some-property", "value");

        // attributes
        var settings = client.getSettings();
        var types = settings.getAttributeTypes().toList();
        for (var t : types)
        {
            if (!t.supports(Security.class))
                continue;
            switch (t.getId())
            {
                case "logo" -> securities.get(0).getAttributes().put(t, "data:image/png;base64,iVBORw0KGgo=");
                case "ter" -> securities.get(4).getAttributes().put(t, 0.0022);
                case "aum" -> securities.get(4).getAttributes().put(t, 123456789L);
                case "vendor" -> securities.get(4).getAttributes().put(t, "Vendor & Co <x>");
                default -> {
                }
            }
        }
        name.abuchen.portfolio.model.AttributeType dateType = new name.abuchen.portfolio.model.AttributeType("myDate");
        dateType.setName("Datum");
        dateType.setColumnLabel("Datum");
        dateType.setTarget(Security.class);
        dateType.setType(LocalDate.class);
        dateType.setConverter(name.abuchen.portfolio.model.AttributeType.DateConverter.class);
        settings.addAttributeType(dateType);
        securities.get(1).getAttributes().put(dateType, LocalDate.of(2023, 3, 4));
        name.abuchen.portfolio.model.AttributeType boolType = new name.abuchen.portfolio.model.AttributeType("myBool");
        boolType.setName("Flag");
        boolType.setColumnLabel("Flag");
        boolType.setTarget(Security.class);
        boolType.setType(Boolean.class);
        boolType.setConverter(name.abuchen.portfolio.model.AttributeType.BooleanConverter.class);
        settings.addAttributeType(boolType);
        securities.get(1).getAttributes().put(boolType, Boolean.TRUE);
        name.abuchen.portfolio.model.AttributeType limitType = new name.abuchen.portfolio.model.AttributeType("myLimit");
        limitType.setName("Limit");
        limitType.setColumnLabel("Limit");
        limitType.setTarget(Security.class);
        limitType.setType(name.abuchen.portfolio.model.LimitPrice.class);
        limitType.setConverter(name.abuchen.portfolio.model.AttributeType.LimitPriceConverter.class);
        settings.addAttributeType(limitType);
        securities.get(2).getAttributes().put(limitType, new name.abuchen.portfolio.model.LimitPrice(
                        name.abuchen.portfolio.model.LimitPrice.RelationalOperator.GREATER_OR_EQUAL, 123_45000000L));
        name.abuchen.portfolio.model.AttributeType shareType = new name.abuchen.portfolio.model.AttributeType("myShare");
        shareType.setName("Stück");
        shareType.setColumnLabel("Stück");
        shareType.setTarget(Security.class);
        shareType.setType(Long.class);
        shareType.setConverter(name.abuchen.portfolio.model.AttributeType.ShareConverter.class);
        settings.addAttributeType(shareType);
        securities.get(2).getAttributes().put(shareType, 5_00000000L);
        settings.getConfigurationSet("client-filter-definitions").add(new name.abuchen.portfolio.model.ConfigurationSet.Configuration("filter-1", "Nur Depot A", depotA.getUUID() + "," + eur.getUUID()));
    }

    public static void main(String[] args) throws IOException
    {
        long seed = Long.parseLong(args[0]);
        File out = new File(args[1]);
        int complexity = args.length > 2 ? Integer.parseInt(args[2]) : 1;
        out.mkdirs();
        Generator g = new Generator(seed, complexity);
        g.generate();
        g.writeFx(new File(out, "rates.csv"));

        String base = "client-" + seed;
        ClientFactory.saveAs(g.client, new File(out, base + ".xml"), null, EnumSet.of(SaveFlag.XML));
        ClientFactory.saveAs(g.client, new File(out, base + "-id.xml"), null,
                        EnumSet.of(SaveFlag.XML, SaveFlag.ID_REFERENCES));
        ClientFactory.saveAs(g.client, new File(out, base + "-zip.portfolio"), null,
                        EnumSet.of(SaveFlag.XML, SaveFlag.COMPRESSED));
        ClientFactory.saveAs(g.client, new File(out, base + "-bin.portfolio"), null,
                        EnumSet.of(SaveFlag.BINARY, SaveFlag.COMPRESSED));
        ClientFactory.saveAs(g.client, new File(out, base + "-plainbin.portfolio"), null, EnumSet.of(SaveFlag.BINARY));
        ClientFactory.saveAs(g.client, new File(out, base + "-enc.portfolio"), "geheim".toCharArray(),
                        EnumSet.of(SaveFlag.BINARY, SaveFlag.ENCRYPTED, SaveFlag.AES256));
        ClientFactory.saveAs(g.client, new File(out, base + "-encxml.portfolio"), "geheim".toCharArray(),
                        EnumSet.of(SaveFlag.XML, SaveFlag.ENCRYPTED, SaveFlag.AES128));
        System.out.println("written " + base);
    }
}
