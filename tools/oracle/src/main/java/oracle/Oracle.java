package oracle;

import java.io.File;
import java.io.FileWriter;
import java.io.Writer;
import java.util.LinkedHashMap;
import java.util.Map;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import name.abuchen.portfolio.model.Client;
import name.abuchen.portfolio.model.ClientFactory;

public class Oracle
{
    public static void main(String[] args) throws Exception
    {
        String command = args[0];
        File file = new File(args[1]);
        char[] password = args.length > 3 && !args[3].isEmpty() ? args[3].toCharArray() : null;
        File out = new File(args[2]);

        Client client = ClientFactory.load(file, password, new org.eclipse.core.runtime.NullProgressMonitor());

        Map<String, Object> result = new LinkedHashMap<>();
        switch (command)
        {
            case "model" -> result.put("model", ModelDump.dump(client));
            case "calc" -> result.putAll(CalcDump.dump(client, args.length > 4 ? args[4] : null));
            default -> throw new IllegalArgumentException(command);
        }

        Gson gson = new GsonBuilder().serializeNulls().serializeSpecialFloatingPointValues()
                        .disableHtmlEscaping().create();
        try (Writer w = new FileWriter(out))
        {
            gson.toJson(result, w);
        }
    }
}
