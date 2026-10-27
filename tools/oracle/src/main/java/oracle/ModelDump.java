package oracle;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import name.abuchen.portfolio.model.Account;
import name.abuchen.portfolio.model.AccountTransaction;
import name.abuchen.portfolio.model.AttributeType;
import name.abuchen.portfolio.model.Classification;
import name.abuchen.portfolio.model.Client;
import name.abuchen.portfolio.model.Dashboard;
import name.abuchen.portfolio.model.InvestmentPlan;
import name.abuchen.portfolio.model.LimitPrice;
import name.abuchen.portfolio.model.Portfolio;
import name.abuchen.portfolio.model.PortfolioTransaction;
import name.abuchen.portfolio.model.Security;
import name.abuchen.portfolio.model.SecurityEvent;
import name.abuchen.portfolio.model.SecurityPrice;
import name.abuchen.portfolio.model.Taxonomy;
import name.abuchen.portfolio.model.Transaction;
import name.abuchen.portfolio.model.Watchlist;

/** canonical representation of the model for comparison with the TypeScript reader */
public class ModelDump
{
    static Object attr(Object v)
    {
        if (v == null)
            return null;
        if (v instanceof LocalDate d)
            return d.toEpochDay();
        if (v instanceof LimitPrice lp)
            {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("op", lp.getRelationalOperator().getOperatorString());
            m.put("value", lp.getValue());
            return m;
        }
        if (v instanceof Long || v instanceof Integer)
            return ((Number) v).longValue();
        return v;
    }

    static Map<String, Object> attributes(name.abuchen.portfolio.model.Attributes a)
    {
        Map<String, Object> m = new TreeMap<>();
        for (Map.Entry<String, Object> e : a.getMap().entrySet())
            m.put(e.getKey(), attr(e.getValue()));
        return m;
    }

    static Map<String, Object> tx(Transaction t)
    {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("uuid", t.getUUID());
        m.put("type", t instanceof AccountTransaction at ? at.getType().name()
                        : ((PortfolioTransaction) t).getType().name());
        m.put("date", t.getDateTime().toString());
        m.put("currency", t.getCurrencyCode());
        m.put("amount", t.getAmount());
        m.put("shares", t.getShares());
        m.put("security", t.getSecurity() != null ? t.getSecurity().getUUID() : null);
        m.put("note", t.getNote());
        m.put("source", t.getSource());
        if (t instanceof AccountTransaction at && at.getExDate() != null)
            m.put("exDate", at.getExDate().toString());
        List<Object> units = new ArrayList<>();
        t.getUnits().forEach(u -> {
            Map<String, Object> um = new LinkedHashMap<>();
            um.put("type", u.getType().name());
            um.put("amount", u.getAmount().getCurrencyCode() + " " + u.getAmount().getAmount());
            if (u.getForex() != null)
            {
                um.put("forex", u.getForex().getCurrencyCode() + " " + u.getForex().getAmount());
                um.put("rate", u.getExchangeRate().stripTrailingZeros().toPlainString());
            }
            units.add(um);
        });
        m.put("units", units);
        if (t.getCrossEntry() != null)
        {
            m.put("cross", t.getCrossEntry().getCrossTransaction(t).getUUID());
            Object owner = t.getCrossEntry().getCrossOwner(t);
            m.put("crossOwner", owner instanceof Account a ? a.getUUID() : ((Portfolio) owner).getUUID());
        }
        return m;
    }

    static Map<String, Object> classification(Classification c)
    {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.getId());
        m.put("name", c.getName());
        m.put("color", c.getColor());
        m.put("weight", c.getWeight());
        m.put("rank", c.getRank());
        m.put("note", c.getNote());
        List<Object> assignments = new ArrayList<>();
        for (Classification.Assignment a : c.getAssignments())
            assignments.add(a.getInvestmentVehicle().getUUID() + ":" + a.getWeight() + ":" + a.getRank());
        m.put("assignments", assignments);
        List<Object> children = new ArrayList<>();
        for (Classification child : c.getChildren())
            children.add(classification(child));
        m.put("children", children);
        return m;
    }

    public static Map<String, Object> dump(Client client)
    {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("version", name.abuchen.portfolio.model.OracleAccess.version(client));
        root.put("baseCurrency", client.getBaseCurrency());

        List<Object> securities = new ArrayList<>();
        for (Security s : client.getSecurities())
        {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("uuid", s.getUUID());
            m.put("name", s.getName());
            m.put("currency", s.getCurrencyCode());
            m.put("target", s.getTargetCurrencyCode());
            m.put("isin", s.getIsin());
            m.put("ticker", s.getTickerSymbol());
            m.put("wkn", s.getWkn());
            m.put("note", s.getNote());
            m.put("feed", s.getFeed());
            m.put("retired", s.isRetired());
            List<SecurityPrice> prices = s.getPrices();
            long sum = 0;
            for (SecurityPrice p : prices)
                sum = sum * 31 % 1000000007L + p.getDate().toEpochDay() * 7 + p.getValue() % 1000003;
            m.put("prices", prices.size());
            m.put("priceChecksum", sum);
            if (!prices.isEmpty())
            {
                m.put("firstPrice", prices.get(0).getDate() + "=" + prices.get(0).getValue());
                m.put("lastPrice", prices.get(prices.size() - 1).getDate() + "=" + prices.get(prices.size() - 1).getValue());
            }
            if (s.getLatest() != null)
                m.put("latest", s.getLatest().getDate() + "=" + s.getLatest().getValue() + "/" + s.getLatest().getHigh()
                                + "/" + s.getLatest().getLow() + "/" + s.getLatest().getVolume());
            List<Object> events = new ArrayList<>();
            for (SecurityEvent e : s.getEvents())
            {
                String str = e.getType().name() + "|" + e.getDate() + "|" + e.getDetails() + "|" + e.getSource();
                if (e instanceof SecurityEvent.DividendEvent de)
                    str += "|" + de.getPaymentDate() + "|" + de.getAmount().getCurrencyCode() + " " + de.getAmount().getAmount();
                events.add(str);
            }
            m.put("events", events);
            m.put("attributes", attributes(s.getAttributes()));
            securities.add(m);
        }
        root.put("securities", securities);

        List<Object> accounts = new ArrayList<>();
        for (Account a : client.getAccounts())
        {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("uuid", a.getUUID());
            m.put("name", a.getName());
            m.put("currency", a.getCurrencyCode());
            m.put("retired", a.isRetired());
            List<Object> txs = new ArrayList<>();
            for (AccountTransaction t : a.getTransactions())
                txs.add(tx(t));
            m.put("transactions", txs);
            accounts.add(m);
        }
        root.put("accounts", accounts);

        List<Object> portfolios = new ArrayList<>();
        for (Portfolio p : client.getPortfolios())
        {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("uuid", p.getUUID());
            m.put("name", p.getName());
            m.put("retired", p.isRetired());
            m.put("referenceAccount", p.getReferenceAccount() != null ? p.getReferenceAccount().getUUID() : null);
            List<Object> txs = new ArrayList<>();
            for (PortfolioTransaction t : p.getTransactions())
                txs.add(tx(t));
            m.put("transactions", txs);
            portfolios.add(m);
        }
        root.put("portfolios", portfolios);

        List<Object> taxonomies = new ArrayList<>();
        for (Taxonomy t : client.getTaxonomies())
        {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", t.getId());
            m.put("name", t.getName());
            m.put("root", classification(t.getRoot()));
            taxonomies.add(m);
        }
        root.put("taxonomies", taxonomies);

        List<Object> watchlists = new ArrayList<>();
        for (Watchlist w : client.getWatchlists())
            watchlists.add(w.getName() + ":" + String.join(",", w.getSecurities().stream().map(Security::getUUID).toList()));
        root.put("watchlists", watchlists);

        List<Object> plans = new ArrayList<>();
        for (InvestmentPlan p : client.getPlans())
        {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", p.getName());
            m.put("security", p.getSecurity() != null ? p.getSecurity().getUUID() : null);
            m.put("portfolio", p.getPortfolio() != null ? p.getPortfolio().getUUID() : null);
            m.put("account", p.getAccount() != null ? p.getAccount().getUUID() : null);
            m.put("start", p.getStart().toString());
            m.put("interval", p.getInterval());
            m.put("amount", p.getAmount());
            m.put("fees", p.getFees());
            m.put("taxes", p.getTaxes());
            m.put("type", p.getPlanType().name());
            m.put("transactions", p.getTransactions().stream().map(Transaction::getUUID).toList());
            plans.add(m);
        }
        root.put("plans", plans);

        List<Object> dashboards = new ArrayList<>();
        client.getDashboards().forEach(d -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", d.getId());
            m.put("name", d.getName());
            m.put("configuration", new TreeMap<>(d.getConfiguration()));
            List<Object> columns = new ArrayList<>();
            for (Dashboard.Column c : d.getColumns())
            {
                Map<String, Object> cm = new LinkedHashMap<>();
                cm.put("weight", c.getWeight());
                List<Object> widgets = new ArrayList<>();
                for (Dashboard.Widget w : c.getWidgets())
                {
                    Map<String, Object> wm = new LinkedHashMap<>();
                    wm.put("type", w.getType());
                    wm.put("label", w.getLabel());
                    wm.put("configuration", new TreeMap<>(w.getConfiguration()));
                    widgets.add(wm);
                }
                cm.put("widgets", widgets);
                columns.add(cm);
            }
            m.put("columns", columns);
            dashboards.add(m);
        });
        root.put("dashboards", dashboards);
        root.put("properties", new TreeMap<>(name.abuchen.portfolio.model.OracleAccess.properties(client)));

        List<Object> attributeTypes = new ArrayList<>();
        client.getSettings().getAttributeTypes().forEach((AttributeType t) -> attributeTypes
                        .add(t.getId() + "|" + t.getName() + "|" + t.getTarget().getName() + "|" + t.getConverter().getClass().getName()));
        root.put("attributeTypes", attributeTypes);
        return root;
    }
}
