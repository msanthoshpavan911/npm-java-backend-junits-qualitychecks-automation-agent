---
applyTo: "**/*Service.java"
---
# Service Layer

- Annotate with `@Service`
- Use constructor injection only — no `@Autowired` on fields
- Mark transactional methods with `@Transactional`
- Throw domain-specific exceptions, not generic RuntimeException
- Test with `@ExtendWith(MockitoExtension.class)` — mock all repositories
