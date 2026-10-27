CREATE TABLE domain_blueprint_state (id INTEGER PRIMARY KEY CHECK(id=1), blueprint_version TEXT NOT NULL, status TEXT NOT NULL);
INSERT INTO domain_blueprint_state VALUES (1,'0.1.0','unfinished-domain');
