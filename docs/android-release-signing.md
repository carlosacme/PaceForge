# Firmar un release Android en una máquina nueva

La app usa **Firma de apps de Google Play**. El keystore local es solo la
**llave de carga** (upload key). No está en el repo: `*.keystore`, `*.jks` y
`android/keystore.properties` están en `.gitignore`.

## Qué necesitas

1. La llave de carga (el archivo `.keystore` que ya usabas, no uno nuevo).
2. Alias y contraseñas de ese almacén.

Si generas un keystore distinto, Play Console rechazará el AAB.

## Pasos

1. Copia `android/keystore.properties.example` a `android/keystore.properties`.
2. Guarda la llave de carga **fuera del repo** (por ejemplo `~/keys/` o
   `C:/Users/you/keys/`). No la pongas en `android/app/` ni en la raíz del
   proyecto.
3. Rellena el properties con la **ruta absoluta** en `storeFile`:

   ```
   storeFile=/home/you/keys/runningapexflow.keystore
   storePassword=...
   keyAlias=runningapexflow
   keyPassword=...
   ```

   En Windows, barras normales sirven:
   `storeFile=C:/Users/you/keys/runningapexflow.keystore`.

4. Desde la raíz: `npm run build`, luego `npx cap sync android`.
5. Desde `android/`: `./gradlew bundleRelease` (`gradlew.bat` en Windows).
6. El AAB queda en `android/app/build/outputs/bundle/release/`.

Sin `keystore.properties` (o con claves vacías) el **debug sigue compilando**.
El **release falla** con un mensaje que apunta a este doc: no hay firma con
valores por defecto.

## Comprobar que es la misma llave de carga

```
keytool -list -v -keystore /home/you/keys/runningapexflow.keystore -alias runningapexflow
```

La SHA-1 debe coincidir con **App signing → Upload key certificate** en Play
Console, no con la del certificado de firma de Play.
