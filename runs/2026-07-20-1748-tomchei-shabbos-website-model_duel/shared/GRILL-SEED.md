# Grill seed (same for every arm)

I want to build a website for a non profit organization running a fundraiser selling mishloach manos for purim. This is run out of a house by users over 60 and therefore must be dumb, simple, easy to use. a lot of things are happening at once and its a small team so the system must account for that. there are different delivery options: shipping, pickup, bulk delivery anytime before purim and per package delivery in the day or two before purim. Each of those has its own rules (per package delivery is priced differently and is only allowed in certain zip codes)

The mishloach manos are packaged in house, so inventory has to be built in house and there must be a production set up.

Fulfillmetn must be easy to use and simple. Until now every night one of the staff would print out the packing slips, labels and greeting cards for all orders that were created that day and bring them in the next day to the "office/warehouse" house. She would then file them into the appropriate folders for location, single item packages and so on. This must be replicated in a simple way.

There also has to be a way to do it this way if the users want to slowly migrate to automation and keep this manual for now. So it has rto be able to print documents without marking it as shipped.

delivery options can be switched by staff, for example, if a package is being shipped to 123 main street and we anyway have a delivery going to 124 main street, we send the shippable box wiuth the edlivery volnteer and then save on shipping costs. Shipping costs on the front end must always rate shop and show the higher rated price between companies (fedex/ups etc) and actually ship using the cheaper solution.

the store needs to be able to shut down for off season, but still allow browsing previous year's catalogs. each year has its own catalog of items.

Order flow: each item is able to be shipped to its own address or delivered. The order entry for both the frontend and for the POS backend should have this built in from the ground up and not bolted on. Recipients must be added to orders, and so on. Every customer has their own address book. I also want a repeat order option, which will take all of the customer's orders and recipients and greeting cards and copy to this year into a draft where it can be confirmed. But this year has different items so how do we repeat? Each item has a replacement item option that I can choose when setting up an item which item from last year I am replacing. There should be a middle page between loading the cart with all the info and the repeat so that the order taker can confirm the replacements are correct.

delivery should be  map where managers can select delivery addresses to add to a route. routes can be sent to a driver volunteer and use google api to order based on quicket route. the map should show shippable items near delivery items so the rule I mentioned above can be added to delivery routes.

front end only allows credit cards, backend allows check and cash payments.
