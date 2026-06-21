---
applyTo: "**/test/**/*.java"
---
# Test Standards

- JUnit5 (`@Test`, `@BeforeEach`, `@ParameterizedTest`)
- Mockito (`@Mock`, `@InjectMocks`, `when().thenReturn()`, `verify()`)
- One assertion focus per test method
- Target 95% line coverage — JaCoCo enforces this on push
- Use `@BeforeEach` for shared setup to avoid duplication
