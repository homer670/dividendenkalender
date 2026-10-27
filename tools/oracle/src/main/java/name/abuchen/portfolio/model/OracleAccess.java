package name.abuchen.portfolio.model;

import java.util.Map;

public class OracleAccess
{
    public static int version(Client client)
    {
        return client.getVersion();
    }

    public static Map<String, String> properties(Client client)
    {
        return client.getProperties();
    }
}
