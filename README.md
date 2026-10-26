# Toledo+

Persoonlijke Chrome/Edge-extensie die de Toledo-startpagina en de vakpagina's (Blackboard Ultra) vervangt door een rustiger overzicht volgens Apple's Human Interface Guidelines.

## Installeren
1. Zet deze map op een vaste plek (bv. ~/Developer/Toledo+). Chrome laadt hem van daaruit.
2. Chrome: ga naar chrome://extensions — Edge: edge://extensions.
3. Zet **Ontwikkelaarsmodus** aan.
4. Klik **Uitgepakte extensie laden** en kies deze map.
5. Open toledo.kuleuven.be/portal en log in.

## Wat het doet
- Deadlines uit Toledo-opdrachten, plus eigen deadlines (opgeslagen in de browser), exporteerbaar als .ics.
- Nieuwe items gegroepeerd per vak, met "Wis".
- Rooster van vandaag en morgen, mededelingen (Ad Valvas + aankondigingen).
- Vakken van dit jaar; communities en vorige jaren ingeklapt.
- Zoeken (⌘K) over alles. Licht/donker volgt je systeem.
- "Klassieke Toledo" in het accountmenu of de footer schakelt terug; de knop "Toledo+" rechtsonder zet het weer aan.

Alle data komt rechtstreeks uit Toledo's eigen /portal/api met jouw sessie; niets wordt elders naartoe gestuurd.

## Vakpagina's (v0.2)
- Op ultra.edu.kuleuven.cloud/ultra/courses/<vak>/outline: recent toegevoegd, de volledige inhoud als uitklapbare mappen, zoeken in het vak, bestanden openen of downloaden met één klik, deadlines van het vak, aankondigingen (uitklapbaar) en de docenten (mail).
- Blauwe stip = nieuw sinds je vorige bezoek aan dat vak.
- "Klassiek" schakelt terug naar Ultra; de knop "Toledo+" linksonder zet het weer aan. Een item openen in Ultra blijft gewoon in Ultra.

Na een update: chrome://extensions → Toledo+ → herlaadknop (↻).
