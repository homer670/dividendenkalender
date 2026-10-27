package oracle;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import name.abuchen.portfolio.model.Client;
import name.abuchen.portfolio.money.ExchangeRate;
import name.abuchen.portfolio.money.ExchangeRateProvider;
import name.abuchen.portfolio.money.ExchangeRateTimeSeries;
import name.abuchen.portfolio.money.impl.ExchangeRateTimeSeriesImpl;

/** Reads EUR based rates from a CSV file (ECB format: Date,USD,CHF,...) given by -Doracle.rates */
public class TestExchangeRateProvider implements ExchangeRateProvider
{
    private List<ExchangeRateTimeSeries> series;

    @Override
    public String getName()
    {
        return "TEST";
    }

    @Override
    public synchronized List<ExchangeRateTimeSeries> getAvailableTimeSeries(Client client)
    {
        if (series == null)
        {
            series = new ArrayList<>();
            String file = System.getProperty("oracle.rates");
            if (file != null)
            {
                try
                {
                    List<String> lines = Files.readAllLines(Path.of(file));
                    String[] header = lines.get(0).split(",");
                    List<ExchangeRateTimeSeriesImpl> list = new ArrayList<>();
                    for (int ii = 1; ii < header.length; ii++)
                        list.add(new ExchangeRateTimeSeriesImpl(this, "EUR", header[ii].trim()));
                    for (int ll = 1; ll < lines.size(); ll++)
                    {
                        String[] cells = lines.get(ll).split(",");
                        LocalDate date = LocalDate.parse(cells[0].trim());
                        for (int ii = 1; ii < cells.length; ii++)
                        {
                            String v = cells[ii].trim();
                            if (v.isEmpty() || v.equals("N/A"))
                                continue;
                            list.get(ii - 1).addRate(new ExchangeRate(date, new BigDecimal(v)));
                        }
                    }
                    series.addAll(list);
                }
                catch (IOException e)
                {
                    throw new IllegalStateException(e);
                }
            }
        }
        return series;
    }
}
