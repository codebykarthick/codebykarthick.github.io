FROM jekyll/builder:latest

WORKDIR /srv/jekyll

# Copy Gemfile first for better layer caching
COPY Gemfile Gemfile.lock* ./

RUN gem install bundler && bundle install

# Copy the rest of the site
COPY . .

EXPOSE 4000

CMD ["bundle", "exec", "jekyll", "serve", "--host", "0.0.0.0"]
